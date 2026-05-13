'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const {
  rollEquipmentStats,
  proficiencyLevelFromCount,
  calcSuccessRate,
  calcProficiencyGain,
  tierFromMaterials,
  avgMaterialStrength,
  strengthGradeLabel,
  harmonyLabel,
} = require('../lib/forgeRollStats');
const { resolveCraftMaterials } = require('../lib/craftResolveMaterials');
const { proceduralSmeltForgeName } = require('../lib/forgeSmeltProceduralName');
const { generateCraftedEquipmentPixelArt } = require('../lib/pixelLabEquipmentArt');
const { metaForProductId } = require('../lib/smeltProduct');

const router = Router();

const DYNAMIC_RECIPE_ID = 'dynamic';
const MAX_DYNAMIC_MATERIALS = 12;
/** 모루에서 산출물만으로 제련 시 최소 개수 */
const MIN_SMELT_MATERIALS_FOR_FORGE = 2;
/** PixelLab 장비 스프라이트 타임아웃 */
const PIXELLAB_FORGE_MS = 110_000;
const SHARED_FORGE_EQUIP_PREFIX = 'shared:forge-equip:';
/** 실패 시 재료 반환 비율 (25~60%) */
const FAIL_RETURN_RATE_MIN = 0.25;
const FAIL_RETURN_RATE_MAX = 0.60;

// ─── 헬퍼 ────────────────────────────────────────────────────

function toPublicEquipment(r) {
  const sourceMaterials = normSourceMaterials(r.sourceCatchIds);
  return {
    id: r.id,
    recipeId: r.recipeId,
    name: r.name,
    itemEmoji: r.itemEmoji,
    emoji: r.itemEmoji,
    tier: r.tier,
    desc: r.desc,
    description: r.desc,
    stats: r.stats,
    sourceCatchIds: sourceMaterials,
    sourceMaterials,
    pixelArt: r.pixelArt,
    createdAt: r.createdAt,
  };
}

function normSourceMaterials(raw) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 0 && typeof raw[0] === 'string') {
    return raw.map((id) => ({ kind: 'catch', id: String(id) }));
  }
  const out = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const id = x.id != null ? String(x.id).trim() : '';
    if (!id) continue;
    const k = String(x.kind || '').toLowerCase();
    if (k === 'equipment' || k === 'equip' || k === 'e') out.push({ kind: 'equipment', id });
    else if (k === 'catch' || k === 'fish' || k === 'c') out.push({ kind: 'catch', id });
    else if (k === 'smelt' || k === 'stock' || k === 's') out.push({ kind: 'smelt', id });
  }
  return out;
}

function sharedForgeEquipCacheKey(name, tier) {
  const t = String(tier || 'common').trim().toLowerCase().slice(0, 20) || 'common';
  const n = String(name || '').trim();
  const base = `${SHARED_FORGE_EQUIP_PREFIX}${t}:`;
  const maxLen = Math.max(1, 100 - base.length);
  return `${base}${n.slice(0, maxLen)}`;
}

/**
 * 요청 본문에서 { kind, id }[] 정규화.
 */
function materialsFromBody(body) {
  const b = body || {};
  if (Array.isArray(b.materials) && b.materials.length > 0) {
    const out = [];
    for (const x of b.materials) {
      if (!x || typeof x !== 'object') continue;
      const id = x.id != null ? String(x.id).trim() : '';
      if (!id || id === 'undefined' || id === 'null') continue;
      const k = String(x.kind || x.type || '').toLowerCase();
      if (k === 'smelt' || k === 'stock' || k === 's') out.push({ kind: 'smelt', id });
      // catch/equipment는 서버에서 거부하지만 파싱은 허용 (오류 메시지용)
      else if (k === 'catch' || k === 'fish' || k === 'c') out.push({ kind: 'catch', id });
      else if (k === 'equipment' || k === 'equip' || k === 'e') out.push({ kind: 'equipment', id });
    }
    return out;
  }
  // 레거시: catchIds 배열
  const catchIdsIn = b.catchIds;
  if (!Array.isArray(catchIdsIn)) return [];
  return catchIdsIn
    .map((x) => String(x).trim())
    .filter((id) => id && id !== 'undefined' && id !== 'null')
    .map((id) => ({ kind: 'catch', id }));
}

// ─── 라우트 ──────────────────────────────────────────────────

/**
 * GET /api/craft/proficiency — 현재 유저의 숙련도 정보
 */
router.get('/proficiency', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { smithingProficiency: true },
    });
    const prof = user ? (user.smithingProficiency || 0) : 0;
    const levelInfo = proficiencyLevelFromCount(prof);
    res.json({ smithingProficiency: prof, levelInfo });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/craft/equipment?limit=50
 * — 로그인 유저의 제작 장비 목록 (최신순)
 */
router.get('/equipment', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const rows = await prisma.craftedEquipment.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ equipment: rows.map(toPublicEquipment) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/craft/equipment
 * — 용광로 산출물(smelt)만으로 장비 제련.
 *
 * 성공/실패 판정:
 *   - 성공률 = 65% + √숙련도×6%  (재료 강도↑ → 확률↓)
 *   - 성공: 장비 생성 + 숙련도 0.005~0.015 증가
 *   - 실패: 장비 파괴 + 재료 25~60% 반환 + 숙련도 0.001~0.005 증가
 *
 * body: { materials: [{ kind: 'smelt', id: string }] }
 */
router.post('/equipment', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    let materials = materialsFromBody(body);

    // smelt 아닌 재료 거부
    const nonSmelt = materials.filter((m) => m.kind !== 'smelt');
    if (nonSmelt.length > 0) {
      return res.status(400).json({
        error: {
          message: '모루에는 기초 재료(용광로 산출물)만 사용할 수 있습니다. 낚시 재료·장비를 먼저 용광로에 넣어 녹이세요.',
        },
      });
    }
    if (materials.length === 0) {
      return res.status(400).json({ error: { message: '재료 목록이 비어 있습니다.' } });
    }
    if (materials.length < MIN_SMELT_MATERIALS_FOR_FORGE) {
      return res.status(400).json({
        error: { message: `기초 재료(산출물)가 최소 ${MIN_SMELT_MATERIALS_FOR_FORGE}개 필요합니다.` },
      });
    }
    if (materials.length > MAX_DYNAMIC_MATERIALS) {
      return res.status(400).json({
        error: { message: `재료는 최대 ${MAX_DYNAMIC_MATERIALS}개까지입니다.` },
      });
    }

    // ── 숙련도 조회 ───────────────────────────────────────────
    const currentProficiency = typeof req.user.smithingProficiency === 'number'
      ? req.user.smithingProficiency
      : ((await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { smithingProficiency: true },
        }))?.smithingProficiency || 0);
    const profInfo = proficiencyLevelFromCount(currentProficiency);

    // 재료 소모 개수 집계
    const smeltNeedById = {};
    for (const m of materials) {
      const sid = String(m.id || '').trim();
      if (!sid) continue;
      smeltNeedById[sid] = (smeltNeedById[sid] || 0) + 1;
    }

    // ── 트랜잭션 ──────────────────────────────────────────────
    const outcome = await prisma.$transaction(async (tx) => {
      // 1. 재료 유효성 확인
      const load = await resolveCraftMaterials(tx, req.user.id, materials);
      if (load.err) return { err: load.err };
      const { resolved } = load;

      // 2. 메타 계산
      const finalName = proceduralSmeltForgeName(resolved);
      const tier = tierFromMaterials(resolved);
      const rollSlots = resolved.map((r) => ({
        kind: r.kind,
        id: r.id,
        size: r.size,
        tier: r.rarity,
      }));
      const materialAvgStr = avgMaterialStrength(rollSlots);
      const materialStrengthLabel = strengthGradeLabel(materialAvgStr);
      const uniqueTierCount = new Set(rollSlots.map((s) => s.tier || 'common')).size;
      const materialHarmonyLabel = harmonyLabel(uniqueTierCount);

      // 3. 성공/실패 판정 (성공률은 평균 강도 기반 — 강한 재료일수록 다루기 어려움)
      const successRate = calcSuccessRate(currentProficiency, materialAvgStr);
      const succeeded = Math.random() < successRate;

      // 4. smelt 재고 차감 (성공/실패 모두 소모)
      for (const [productId, usedCount] of Object.entries(smeltNeedById)) {
        const updated = await tx.smeltStock.updateMany({
          where: {
            userId: req.user.id,
            productId,
            count: { gte: usedCount },
          },
          data: { count: { decrement: usedCount } },
        });
        if (updated.count !== 1) return { err: 'NOT_ENOUGH_SMELT' };
      }
      await tx.smeltStock.deleteMany({
        where: { userId: req.user.id, count: { lte: 0 } },
      });

      // 5a. 실패 처리 — 재료 일부 반환 후 종료
      if (!succeeded) {
        const returnedMaterials = {}; // { productId: count }
        for (const [productId, usedCount] of Object.entries(smeltNeedById)) {
          const rate = FAIL_RETURN_RATE_MIN + Math.random() * (FAIL_RETURN_RATE_MAX - FAIL_RETURN_RATE_MIN);
          const returnCount = Math.floor(usedCount * rate);
          if (returnCount <= 0) continue;
          returnedMaterials[productId] = returnCount;
          await tx.smeltStock.upsert({
            where: { userId_productId: { userId: req.user.id, productId } },
            create: { userId: req.user.id, productId, count: returnCount },
            update: { count: { increment: returnCount } },
          });
        }
        return {
          success: false,
          materialStrengthLabel,
          materialHarmonyLabel,
          uniqueTierCount,
          successRate,
          returnedMaterials,
        };
      }

      // 5b. 성공 처리 — 장비 생성
      const stats = rollEquipmentStats(tier, rollSlots, profInfo.mul);
      const desc = `기초 재료 ${materials.length}종을 제련했습니다.`.slice(0, 400);
      const sourceStored = materials.map((m) => ({ kind: m.kind, id: m.id }));
      const created = await tx.craftedEquipment.create({
        data: {
          userId: req.user.id,
          recipeId: DYNAMIC_RECIPE_ID,
          name: String(finalName).slice(0, 120),
          itemEmoji: '⚔️',
          tier: String(tier || 'common').slice(0, 20),
          desc,
          stats,
          sourceCatchIds: sourceStored,
          pixelArt: null,
        },
      });
      return {
        success: true,
        equipment: created,
        materialStrengthLabel,
        materialHarmonyLabel,
        uniqueTierCount,
        successRate,
      };
    });

    // ── 트랜잭션 오류 처리 ────────────────────────────────────
    if (outcome.err === 'NOT_FOUND_OR_SOLD') {
      return res.status(400).json({ error: { message: '낚시 재료를 찾을 수 없거나 이미 판매된 항목입니다.' } });
    }
    if (outcome.err === 'NOT_FOUND_EQUIPMENT') {
      return res.status(400).json({ error: { message: '재료로 쓸 장비를 찾을 수 없습니다.' } });
    }
    if (outcome.err === 'NOT_ENOUGH_SMELT') {
      return res.status(400).json({ error: { message: '산출물 재고가 부족합니다.' } });
    }

    // ── 숙련도 증가 (성공/실패 모두, 성공이 더 많이) ──────────
    const profGain = calcProficiencyGain(currentProficiency, outcome.success);
    let newProficiency = currentProficiency;
    let newProfInfo = profInfo;
    try {
      const updatedUser = await prisma.user.update({
        where: { id: req.user.id },
        data: { smithingProficiency: { increment: profGain } },
        select: { smithingProficiency: true },
      });
      newProficiency = updatedUser.smithingProficiency;
      newProfInfo = proficiencyLevelFromCount(newProficiency);
    } catch (e) {
      console.warn('[craft/equipment] proficiency increment failed (non-fatal):', e?.message);
    }

    const { materialStrengthLabel, materialHarmonyLabel, uniqueTierCount, successRate } = outcome;
    const successRatePct = Math.round(successRate * 100);

    // ── 실패 응답 ─────────────────────────────────────────────
    if (!outcome.success) {
      // returnedMaterials를 이름/이모지 포함한 배열로 변환
      const returnedList = Object.entries(outcome.returnedMaterials || {}).map(([pid, cnt]) => {
        const meta = metaForProductId(pid);
        return { id: pid, name: meta.name, emoji: meta.emoji, count: cnt };
      });
      return res.status(200).json({
        success: false,
        successRatePct,
        materialStrengthLabel,
        materialHarmonyLabel,
        uniqueTierCount,
        returnedMaterials: returnedList,
        smithingProficiency: newProficiency,
        proficiencyLevelInfo: newProfInfo,
        proficiencyGain: Number(profGain.toFixed(6)),
      });
    }

    // ── 성공: 이미지 처리 ────────────────────────────────────
    const createdRow = outcome.equipment;
    const cacheKey = sharedForgeEquipCacheKey(createdRow.name, createdRow.tier);

    // 이미지 캐시 확인 (같은 이름+티어 → 같은 이미지)
    try {
      const cached = await prisma.sharedPixelArt.findUnique({
        where: { name: cacheKey },
        select: { imageData: true },
      });
      if (cached && cached.imageData) {
        await prisma.craftedEquipment.update({
          where: { id: createdRow.id, userId: req.user.id },
          data: {
            pixelArt: { source: 'shared_cache', cacheKey, imageDataUrl: cached.imageData },
          },
        });
        const freshCached = await prisma.craftedEquipment.findUnique({ where: { id: createdRow.id } });
        return res.status(201).json({
          success: true,
          successRatePct,
          equipment: toPublicEquipment(freshCached || createdRow),
          nameSource: 'smelt_procedural',
          materialStrengthLabel,
          materialHarmonyLabel,
          uniqueTierCount,
          smithingProficiency: newProficiency,
          proficiencyLevelInfo: newProfInfo,
          proficiencyGain: Number(profGain.toFixed(6)),
        });
      }
    } catch (e) {
      console.warn('[craft/equipment] cache lookup skipped:', e?.message);
    }

    // PixelLab 새 이미지 생성
    const pixelAc = new AbortController();
    const pixelTimer = setTimeout(() => pixelAc.abort(), PIXELLAB_FORGE_MS);
    try {
      const png = await generateCraftedEquipmentPixelArt(
        createdRow.name,
        createdRow.tier,
        pixelAc.signal,
        null,
      );
      if (png) {
        await prisma.craftedEquipment.update({
          where: { id: createdRow.id, userId: req.user.id },
          data: { pixelArt: { source: 'pixellab', imageDataUrl: png } },
        });
        try {
          await prisma.sharedPixelArt.upsert({
            where: { name: cacheKey },
            create: {
              name: cacheKey,
              imageData: png,
              rarity: String(createdRow.tier || 'common').slice(0, 20),
              type: 'forge_equipment',
            },
            update: {
              imageData: png,
              rarity: String(createdRow.tier || 'common').slice(0, 20),
            },
          });
        } catch (e) {
          console.warn('[craft/equipment] cache save skipped:', e?.message);
        }
      }
    } catch (e) {
      console.warn('[craft/equipment] PixelLab skipped:', e?.message);
    } finally {
      clearTimeout(pixelTimer);
    }

    const fresh = await prisma.craftedEquipment.findUnique({ where: { id: createdRow.id } });
    res.status(201).json({
      success: true,
      successRatePct,
      equipment: toPublicEquipment(fresh || createdRow),
      nameSource: 'smelt_procedural',
      materialStrengthLabel,
      materialHarmonyLabel,
      uniqueTierCount,
      smithingProficiency: newProficiency,
      proficiencyLevelInfo: newProfInfo,
      proficiencyGain: Number(profGain.toFixed(6)),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
