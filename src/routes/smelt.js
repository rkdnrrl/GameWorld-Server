'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const {
  inferSmeltProductsFromMaterialName,
  metaForProductId,
  ALLOWED_IDS,
} = require('../lib/smeltProduct');
const { inferSmeltProductsFromEquipmentNames } = require('../lib/geminiSmeltInference');
const { logActivity } = require('../lib/activityLog');
const { smeltProductsFromNoun } = require('../lib/smeltLookup');
// 명사 등급별 재료 수량 — 명사가 무엇인지(noun)가 얼마나 나오는지를 결정
const YIELD_BY_NOUN_TIER = {
  common:    1,
  uncommon:  2,
  rare:      3,
  epic:      5,
  legendary: 8,
  mythic:    13,
  divine:    21,
};

const router = Router();
const MAX_MELT_PER_REQUEST = 40;
const MAX_STOCK_PER_PRODUCT = 999_999;
const GEMINI_SMELT_TIMEOUT_MS = 7000;
/** 장비 녹일 때 각 재료의 생존 확률 (0.0~1.0) */
const EQUIP_SMELT_SURVIVAL_RATE = 0.70;

function rowsToStockPayload(rows) {
  const stock = {};
  for (const r of rows) {
    if (!r || r.count <= 0) continue;
    const meta = metaForProductId(r.productId);
    stock[r.productId] = {
      id: r.productId,
      name: meta.name,
      emoji: meta.emoji,
      count: r.count,
    };
  }
  return stock;
}

/**
 * GET /api/smelt/stock — 로그인 유저의 용광로 산출물 집계
 */
router.get('/stock', requireAuth, async (req, res, next) => {
  try {
    const rows = await prisma.smeltStock.findMany({
      where: { userId: req.user.id },
    });
    res.json({ stock: rowsToStockPayload(rows) });
  } catch (err) {
    next(err);
  }
});

function normalizeIdArray(raw) {
  return Array.isArray(raw) ? [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))] : [];
}

/**
 * POST /api/smelt/melt — 낚시 재료/장비를 녹여 산출물 카운트 증가
 * body: { catchIds?: string[], equipmentIds?: string[] }
 */
router.post('/melt', requireAuth, async (req, res, next) => {
  try {
    const catchIds = normalizeIdArray(req.body && req.body.catchIds);
    const equipmentIds = normalizeIdArray(req.body && req.body.equipmentIds);
    const moduleIds = normalizeIdArray(req.body && req.body.moduleIds);
    const total = catchIds.length + equipmentIds.length + moduleIds.length;
    if (total === 0) {
      return res.status(400).json({ error: { message: 'catchIds, equipmentIds 또는 moduleIds 배열이 필요합니다.' } });
    }
    if (total > MAX_MELT_PER_REQUEST) {
      return res.status(400).json({ error: { message: `한 번에 최대 ${MAX_MELT_PER_REQUEST}개까지 녹일 수 있습니다.` } });
    }

    // 장비 사전 조회 — sourceCatchIds로 실제 재료 확인
    let equipRows = [];
    let geminiEquipIds = []; // sourceCatchIds 없는 구형 장비 → Gemini fallback
    let geminiEquipProductYields = [];

    if (equipmentIds.length > 0) {
      equipRows = await prisma.craftedEquipment.findMany({
        where: { id: { in: equipmentIds }, userId: req.user.id },
        select: { id: true, name: true, sourceCatchIds: true },
      });
      if (equipRows.length !== equipmentIds.length) {
        return res.status(400).json({
          error: { message: '일부 장비를 찾을 수 없거나 이미 처리되었습니다.' },
        });
      }
      // sourceCatchIds가 없는(구형) 장비는 Gemini로 처리
      geminiEquipIds = equipRows
        .filter((r) => {
          const mats = Array.isArray(r.sourceCatchIds) ? r.sourceCatchIds.filter((m) => m && m.kind === 'smelt') : [];
          return mats.length === 0;
        })
        .map((r) => r.id);

      if (geminiEquipIds.length > 0) {
        const geminiNames = geminiEquipIds.map((id) => {
          const row = equipRows.find((r) => r.id === id);
          return row ? String(row.name || '') : '';
        });
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), GEMINI_SMELT_TIMEOUT_MS);
        try {
          geminiEquipProductYields = await inferSmeltProductsFromEquipmentNames(geminiNames, { signal: ac.signal });
        } finally {
          clearTimeout(timer);
        }
      }
    }

    const out = await prisma.$transaction(async (tx) => {
      const delta = {};

      if (catchIds.length > 0) {
        const catchRows = await tx.catch.findMany({
          where: {
            id: { in: catchIds },
            userId: req.user.id,
            sold: false,
          },
        });
        if (catchRows.length !== catchIds.length) {
          return { err: 'NOT_FOUND' };
        }
        for (const row of catchRows) {
          const nounResult = smeltProductsFromNoun(row.itemName);
          const ids = nounResult?.products || inferSmeltProductsFromMaterialName(row.itemName);
          const yieldCount = YIELD_BY_NOUN_TIER[nounResult?.tier || 'common'] || 1;
          for (const pid of ids) {
            if (!ALLOWED_IDS.has(pid)) continue;
            delta[pid] = (delta[pid] || 0) + yieldCount;
          }
        }
        await tx.catch.deleteMany({
          where: {
            id: { in: catchRows.map((r) => r.id) },
            userId: req.user.id,
          },
        });
      }

      const recovered = {}; // { productId: count }
      const lost      = {}; // { productId: count }

      if (equipmentIds.length > 0) {
        // 트랜잭션 내 재확인
        const txEquipRows = await tx.craftedEquipment.findMany({
          where: { id: { in: equipmentIds }, userId: req.user.id },
          select: { id: true },
        });
        if (txEquipRows.length !== equipmentIds.length) {
          return { err: 'NOT_FOUND_EQUIPMENT' };
        }

        // 재료 기록이 있는 장비 — 소실률 적용
        for (const row of equipRows) {
          const smeltMats = Array.isArray(row.sourceCatchIds)
            ? row.sourceCatchIds.filter((m) => m && m.kind === 'smelt')
            : [];
          if (smeltMats.length > 0) {
            for (const mat of smeltMats) {
              const pid = String(mat.id || '').trim();
              if (!ALLOWED_IDS.has(pid)) continue;
              if (Math.random() < EQUIP_SMELT_SURVIVAL_RATE) {
                delta[pid]     = (delta[pid]     || 0) + 1;
                recovered[pid] = (recovered[pid] || 0) + 1;
              } else {
                lost[pid] = (lost[pid] || 0) + 1;
              }
            }
          }
        }

        // 재료 기록 없는 구형 장비 — Gemini 결과 사용 (소실 없음)
        for (const list of geminiEquipProductYields) {
          for (const pid of list || []) {
            if (!ALLOWED_IDS.has(pid)) continue;
            delta[pid]     = (delta[pid]     || 0) + 1;
            recovered[pid] = (recovered[pid] || 0) + 1;
          }
        }

        await tx.craftedEquipment.deleteMany({
          where: { id: { in: txEquipRows.map((r) => r.id) }, userId: req.user.id },
        });
      }

      // 모듈 녹이기 — 티어별 고정 수율로 일반 금속 반환
      if (moduleIds.length > 0) {
        const modRows = await tx.module.findMany({
          where: { id: { in: moduleIds }, userId: req.user.id },
          select: { id: true, tier: true, equippedTo: true },
        });
        if (modRows.length !== moduleIds.length) {
          return { err: 'NOT_FOUND_MODULE' };
        }
        const equipped = modRows.find((m) => m.equippedTo);
        if (equipped) {
          return { err: 'MODULE_EQUIPPED' };
        }
        const MODULE_YIELD = { common: 1, rare: 2, epic: 3, legendary: 5 };
        const MODULE_POOL  = ['iron', 'copper', 'aluminum', 'nickel', 'zinc', 'tin', 'slag'];
        for (const mod of modRows) {
          const yieldCount = MODULE_YIELD[mod.tier] || 1;
          for (let i = 0; i < yieldCount; i++) {
            const pid = MODULE_POOL[Math.floor(Math.random() * MODULE_POOL.length)];
            if (!ALLOWED_IDS.has(pid)) continue;
            if (Math.random() < EQUIP_SMELT_SURVIVAL_RATE) {
              delta[pid]     = (delta[pid]     || 0) + 1;
              recovered[pid] = (recovered[pid] || 0) + 1;
            } else {
              lost[pid] = (lost[pid] || 0) + 1;
            }
          }
        }
        await tx.module.deleteMany({
          where: { id: { in: modRows.map((r) => r.id) }, userId: req.user.id },
        });
      }

      for (const [productId, add] of Object.entries(delta)) {
        const inc = Math.min(MAX_STOCK_PER_PRODUCT, Math.max(0, Math.floor(Number(add)) || 0));
        if (inc <= 0) continue;
        await tx.smeltStock.upsert({
          where: {
            userId_productId: {
              userId: req.user.id,
              productId,
            },
          },
          create: {
            userId: req.user.id,
            productId,
            count: inc,
          },
          update: {
            count: {
              increment: inc,
            },
          },
        });
      }

      const allRows = await tx.smeltStock.findMany({
        where: { userId: req.user.id },
      });
      return { stock: rowsToStockPayload(allRows), recovered, lost };
    });

    if (out.err === 'NOT_FOUND' || out.err === 'NOT_FOUND_EQUIPMENT') {
      return res.status(400).json({
        error: { message: '일부 재료를 찾을 수 없거나 이미 처리되었습니다.' },
      });
    }
    if (out.err === 'NOT_FOUND_MODULE') {
      return res.status(400).json({ error: { message: '일부 모듈을 찾을 수 없습니다.' } });
    }
    if (out.err === 'MODULE_EQUIPPED') {
      return res.status(400).json({ error: { message: '장비에 부착된 모듈은 먼저 분리해야 녹일 수 있습니다.' } });
    }

    // recovered/lost를 이름·이모지 포함 배열로 변환해 응답
    const toList = (obj) =>
      Object.entries(obj || {})
        .filter(([, c]) => c > 0)
        .map(([pid, count]) => { const meta = metaForProductId(pid); return { id: pid, name: meta.name, emoji: meta.emoji, count }; });

    const gained = toList(out.recovered);
    const lost = toList(out.lost);
    logActivity(req.user, 'smelt_melt', {
      meltCount: total,
      catchCount: catchIds.length,
      equipmentCount: equipmentIds.length,
      gained,
      lost,
    });
    res.json({ stock: out.stock, recovered: gained, lost });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/smelt/bootstrap — 서버 산출물이 비어 있을 때만, 로컬 재고를 한 번 이관
 * body: { stock: { glass?: { count }, ... } }
 */
router.post('/bootstrap', requireAuth, async (req, res, next) => {
  try {
    const count = await prisma.smeltStock.count({ where: { userId: req.user.id } });
    if (count > 0) {
      return res.status(409).json({ error: { message: '이미 서버에 산출물이 있어 부트스트랩할 수 없습니다.' } });
    }

    const stockIn = req.body && req.body.stock && typeof req.body.stock === 'object' ? req.body.stock : {};
    const merged = new Map();
    for (const k of Object.keys(stockIn)) {
      const pid = String(k).trim();
      if (!ALLOWED_IDS.has(pid)) continue;
      const v = stockIn[k];
      const c = Math.floor(Number(v && v.count));
      if (!Number.isFinite(c) || c <= 0) continue;
      const add = Math.min(MAX_STOCK_PER_PRODUCT, c);
      merged.set(pid, (merged.get(pid) || 0) + add);
    }
    const entries = [...merged.entries()].map(([productId, count]) => ({
      productId,
      count: Math.min(MAX_STOCK_PER_PRODUCT, count),
    }));

    if (entries.length === 0) {
      return res.status(400).json({ error: { message: '이관할 유효한 산출물이 없습니다.' } });
    }

    await prisma.$transaction(async (tx) => {
      for (const e of entries) {
        await tx.smeltStock.create({
          data: {
            userId: req.user.id,
            productId: e.productId,
            count: e.count,
          },
        });
      }
    });

    const rows = await prisma.smeltStock.findMany({ where: { userId: req.user.id } });
    res.status(201).json({ stock: rowsToStockPayload(rows) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
