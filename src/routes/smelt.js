'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const {
  inferSmeltProductFromMaterialName,
  metaForProductId,
  ALLOWED_IDS,
} = require('../lib/smeltProduct');

const router = Router();
const MAX_MELT_PER_REQUEST = 40;
const MAX_STOCK_PER_PRODUCT = 999_999;

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

/**
 * POST /api/smelt/melt — catch id 들을 녹여 산출물 카운트 증가 (catch 삭제)
 * body: { catchIds: string[] }
 */
router.post('/melt', requireAuth, async (req, res, next) => {
  try {
    const raw = req.body && req.body.catchIds;
    const catchIds = Array.isArray(raw)
      ? [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))]
      : [];
    if (catchIds.length === 0) {
      return res.status(400).json({ error: { message: 'catchIds 배열이 필요합니다.' } });
    }
    if (catchIds.length > MAX_MELT_PER_REQUEST) {
      return res.status(400).json({ error: { message: `한 번에 최대 ${MAX_MELT_PER_REQUEST}개까지 녹일 수 있습니다.` } });
    }

    const out = await prisma.$transaction(async (tx) => {
      const rows = await tx.catch.findMany({
        where: {
          id: { in: catchIds },
          userId: req.user.id,
          sold: false,
        },
      });
      if (rows.length !== catchIds.length) {
        return { err: 'NOT_FOUND' };
      }

      const delta = {};
      for (const row of rows) {
        const p = inferSmeltProductFromMaterialName(row.itemName);
        delta[p.id] = (delta[p.id] || 0) + 1;
      }

      await tx.catch.deleteMany({
        where: {
          id: { in: rows.map((r) => r.id) },
          userId: req.user.id,
        },
      });

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
      return { stock: rowsToStockPayload(allRows) };
    });

    if (out.err === 'NOT_FOUND') {
      return res.status(400).json({
        error: { message: '일부 재료를 찾을 수 없거나 이미 처리되었습니다.' },
      });
    }

    res.json({ stock: out.stock });
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
