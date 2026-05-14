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
  detectSynergies,
} = require('../lib/forgeRollStats');
const { resolveCraftMaterials } = require('../lib/craftResolveMaterials');
const { metaForProductId } = require('../lib/smeltProduct');
const { logActivity } = require('../lib/activityLog');
const { generateCraftedEquipmentPixelArt } = require('../lib/pixelLabEquipmentArt');

const router = Router();

const DYNAMIC_RECIPE_ID = 'dynamic';
const MAX_DYNAMIC_MATERIALS = 12;
/** 모루에서 산출물만으로 제련 시 최소 개수 */
const MIN_SMELT_MATERIALS_FOR_FORGE = 1;
/** 실패 시 재료 반환 비율 (25~60%) */
const FAIL_RETURN_RATE_MIN = 0.25;
const FAIL_RETURN_RATE_MAX = 0.60;

/** 산출물 ID → 선호 슬롯 인덱스 (0~8). 해시로 결정되므로 재료마다 고유. */
function preferredSlotFromId(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 9;
}
/** 재료가 선호 슬롯에 있으면 FIT_BONUS, 아니면 FIT_PENALTY 배율 적용 */
const FIT_BONUS   = 2.0;
const FIT_PENALTY = 0.4;

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

/**
 * 요청 본문에서 { kind, id, slotIndex }[] 정규화.
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
      const slotIndex = Number.isInteger(x.slotIndex) ? Math.max(0, Math.min(8, x.slotIndex)) : 0;
      if (k === 'smelt' || k === 'stock' || k === 's') out.push({ kind: 'smelt', id, slotIndex });
      else if (k === 'catch' || k === 'fish' || k === 'c') out.push({ kind: 'catch', id, slotIndex });
      else if (k === 'equipment' || k === 'equip' || k === 'e') out.push({ kind: 'equipment', id, slotIndex });
    }
    return out;
  }
  const catchIdsIn = b.catchIds;
  if (!Array.isArray(catchIdsIn)) return [];
  return catchIdsIn
    .map((x) => String(x).trim())
    .filter((id) => id && id !== 'undefined' && id !== 'null')
    .map((id, i) => ({ kind: 'catch', id, slotIndex: i }));
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
    const customName = body.customName && typeof body.customName === 'string'
      ? body.customName.trim().slice(0, 24) : null;
    const pixelArtData = Array.isArray(body.pixelArtData) && body.pixelArtData.length === 1024
      ? body.pixelArtData : null;
    const pixelArtUrl = typeof body.pixelArtUrl === 'string' && body.pixelArtUrl.startsWith('data:image/')
      ? body.pixelArtUrl : null;

    // 재료별 선호 슬롯 적합도 계산
    const correctCount = materials.filter((m) => preferredSlotFromId(m.id) === m.slotIndex).length;
    const fitnessMul = materials.length > 0
      ? (correctCount * FIT_BONUS + (materials.length - correctCount) * FIT_PENALTY) / materials.length
      : 1.0;
    const itemEmoji = '⚒️';
    const slot = 'weapon';

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
      const finalName = customName || '미정';
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
      const activeSynergies = detectSynergies(rollSlots); // 발동된 시너지 목록

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
          activeSynergies,
          successRate,
          returnedMaterials,
        };
      }

      // 5b. 성공 처리 — 장비 생성 (선호 슬롯 적합도로 스탯 배율 결정)
      const rawStats = rollEquipmentStats(tier, rollSlots, profInfo.mul);
      const f = fitnessMul;
      const stats = {
        equipSlot: slot,
        attackBonus:  Math.max(0, Math.round(rawStats.attackBonus  * f)),
        defenseBonus: Math.max(0, Math.round(rawStats.defenseBonus * f)),
        speedBonus:   Number(Math.max(0, Math.min(0.5, rawStats.speedBonus * f)).toFixed(3)),
        durabilityMax: Math.max(5, Math.round(rawStats.durabilityMax * f)),
        hpBonus: Math.max(0, Math.round((rawStats.defenseBonus * 3 + rawStats.attackBonus * 0.5) * f)),
      };
      const desc = `기초 재료 ${materials.length}종을 제련했습니다.`.slice(0, 400);
      const sourceStored = materials.map((m) => ({ kind: m.kind, id: m.id }));
      const created = await tx.craftedEquipment.create({
        data: {
          userId: req.user.id,
          recipeId: DYNAMIC_RECIPE_ID,
          name: String(finalName).slice(0, 120),
          itemEmoji,
          tier: String(tier || 'common').slice(0, 20),
          desc,
          stats,
          sourceCatchIds: sourceStored,
          pixelArt: pixelArtUrl
            ? { imageDataUrl: pixelArtUrl, source: 'pixellab' }
            : (pixelArtData || null),
        },
      });
      return {
        success: true,
        equipment: created,
        fitScore: { correct: correctCount, total: materials.length },
        materialStrengthLabel,
        materialHarmonyLabel,
        uniqueTierCount,
        activeSynergies,
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

    const { materialStrengthLabel, materialHarmonyLabel, uniqueTierCount, activeSynergies, successRate } = outcome;
    const successRatePct = Math.round(successRate * 100);
    // activeSynergies: 클라이언트에 보낼 경량 형식 (id, name, bonusMul)
    const synergiesOut = (activeSynergies || []).map(({ id, name, bonusMul }) => ({ id, name, bonusMul }));

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
        activeSynergies: synergiesOut,
        returnedMaterials: returnedList,
        smithingProficiency: newProficiency,
        proficiencyLevelInfo: newProfInfo,
        proficiencyGain: Number(profGain.toFixed(6)),
      });
    }

    const createdRow = outcome.equipment;
    logActivity(req.user, 'forge_craft', {
      name: createdRow.name,
      tier: createdRow.tier,
      slot,
      itemEmoji: createdRow.itemEmoji,
      nameSource: 'grid',
      materialCount: materials.length,
    });
    res.status(201).json({
      success: true,
      successRatePct,
      equipment: toPublicEquipment(createdRow),
      nameSource: 'grid',
      fitScore: outcome.fitScore,
      materialStrengthLabel,
      materialHarmonyLabel,
      uniqueTierCount,
      activeSynergies: synergiesOut,
      smithingProficiency: newProficiency,
      proficiencyLevelInfo: newProfInfo,
      proficiencyGain: Number(profGain.toFixed(6)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/craft/equipment/:id
 * — 내구도 0으로 파괴된 장비를 DB에서 삭제.
 */
/**
 * GET /api/craft/recipe-check?slot=weapon&ids=id1,id2,...
 * 해당 조합이 도감에 존재하는지 확인 (생성 없음).
 */
router.get('/recipe-check', requireAuth, async (req, res, next) => {
  try {
    const slot = String(req.query.slot || 'weapon').trim();
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).sort();
    if (ids.length === 0) return res.json({ isNew: false });
    const recipeKey = `recipe:${slot}:${ids.join('|')}`;
    const existing = await prisma.sharedPixelArt.findUnique({ where: { name: recipeKey } });
    res.json({ isNew: !existing });
  } catch (err) {
    next(err);
  }
});

// 티어별 내구도 1당 수리 비용 (코인)
const REPAIR_COST_PER_DUR = { common: 5, rare: 12, epic: 30, legendary: 70 };

router.post('/equipment/:id/repair', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: { message: 'id 필요' } });

    const equip = await prisma.craftedEquipment.findUnique({ where: { id } });
    if (!equip || equip.userId !== req.user.id) {
      return res.status(404).json({ error: { message: '장비를 찾을 수 없습니다.' } });
    }

    const stats = equip.stats || {};
    const durMax = Number(stats.durabilityMax || 0);
    const durCur = stats.durability != null ? Number(stats.durability) : durMax;

    if (durMax <= 0) return res.status(400).json({ error: { message: '내구도가 없는 장비입니다.' } });
    if (durCur >= durMax) return res.status(400).json({ error: { message: '이미 완전한 상태입니다.' } });

    const requestedAmount = req.body?.amount != null ? Number(req.body.amount) : null;
    const repairAmount = (requestedAmount != null && Number.isFinite(requestedAmount))
      ? Math.min(Math.max(1, Math.round(requestedAmount)), durMax - durCur)
      : durMax - durCur;
    const newDur = Math.min(durMax, durCur + repairAmount);

    const tier = String(equip.tier || 'common').toLowerCase();
    const costPerDur = REPAIR_COST_PER_DUR[tier] ?? REPAIR_COST_PER_DUR.common;
    const cost = Math.max(1, Math.ceil(repairAmount * costPerDur));

    const newStats = { ...stats, durability: newDur };

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: req.user.id }, select: { coins: true } });
      if ((user?.coins ?? 0) < cost) throw Object.assign(new Error('COINS'), { status: 402 });

      await tx.user.update({ where: { id: req.user.id }, data: { coins: { decrement: cost } } });
      return tx.craftedEquipment.update({ where: { id }, data: { stats: newStats } });
    });

    res.json({ ok: true, costPaid: cost, equipment: toPublicEquipment(updated) });
  } catch (err) {
    if (err.status === 402) return res.status(402).json({ error: { message: '코인이 부족합니다.' } });
    next(err);
  }
});

router.delete('/equipment/:id', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: { message: 'id 필요' } });
    await prisma.craftedEquipment.deleteMany({
      where: { id, userId: req.user.id },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** 한국어 이름에서 장비 슬롯 추출 */
function _slotFromName(name) {
  const n = String(name || '');
  if (n.includes('투구')) return 'head';
  if (n.includes('갑옷') || n.includes('흉갑')) return 'chest';
  if (n.includes('장화') || n.includes('부츠')) return 'boots';
  if (n.includes('장갑')) return 'gloves';
  if (n.includes('반지') || n.includes('목걸이') || n.includes('망토') || n.includes('벨트')) return 'accessory';
  return 'weapon';
}

/**
 * POST /api/craft/generate-pixel-art
 * 이름·티어 기반 PixelLab 이미지 생성. SharedPixelArt 테이블에 캐시.
 * 같은 이름으로 재요청하면 캐시에서 즉시 반환.
 */
router.post('/generate-pixel-art', requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 40);
    const tier = String(req.body?.tier || 'common').toLowerCase();
    if (!name) return res.status(400).json({ error: { message: 'name 필요' } });

    const cacheKey = `equip-art:${name}`.slice(0, 100);

    // 캐시 조회 (캐시 히트는 보상 없음)
    const cached = await prisma.sharedPixelArt.findUnique({ where: { name: cacheKey } });
    if (cached) return res.json({ imageDataUrl: cached.imageData, cached: true, coinReward: 0 });

    // PixelLab 생성 — 실제 대기시간 측정
    const genStart = Date.now();
    const imageDataUrl = await generateCraftedEquipmentPixelArt(
      name, tier, undefined, null, _slotFromName(name),
    );
    const elapsedSec = Math.round((Date.now() - genStart) / 1000);

    if (!imageDataUrl) {
      return res.status(503).json({ error: { message: 'PixelLab 생성 실패 (API 키 없음 또는 서버 오류)' } });
    }

    // 캐시 저장
    try {
      await prisma.sharedPixelArt.upsert({
        where: { name: cacheKey },
        create: { name: cacheKey, imageData: imageDataUrl, rarity: tier, type: 'equipment' },
        update: { imageData: imageDataUrl, rarity: tier },
      });
    } catch (e) {
      console.warn('[generate-pixel-art] cache save failed (non-fatal):', e?.message);
    }

    // 대기 보상: 실제 생성 시간 기준 코인 지급 (최소 2, 최대 50)
    const coinReward = Math.min(50, Math.max(2, Math.ceil(elapsedSec * 1.5)));
    try {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { coins: { increment: coinReward } },
      });
    } catch (e) {
      console.warn('[generate-pixel-art] coin reward failed (non-fatal):', e?.message);
    }

    res.json({ imageDataUrl, cached: false, coinReward, elapsedSec });
  } catch (err) {
    next(err);
  }
});

// ─── 강화 시스템 ──────────────────────────────────────────────

const ENHANCE_ITEM_META = {
  stone_common:  { name: '일반 강화석', emoji: '🪨', successRate: 0.60, mode: 'random_primary', amount: 1 },
  stone_rare:    { name: '희귀 강화석', emoji: '💎', successRate: 0.70, mode: 'random_primary', amount: 2 },
  crystal_magic: { name: '마법 수정',   emoji: '🔮', successRate: 0.80, mode: 'all',
                   bonuses: { atk: 1, def: 1, spd: 0.02, hp: 5 } },
  shard_legend:  { name: '전설 파편',   emoji: '✨', successRate: 0.85, mode: 'all',
                   bonuses: { atk: 3, def: 3, spd: 0.05, hp: 10 } },
};

/**
 * GET /api/craft/enhancement-stock
 * 현재 유저의 강화 아이템 재고 조회
 */
router.get('/enhancement-stock', requireAuth, async (req, res, next) => {
  try {
    const rows = await prisma.enhancementStock.findMany({ where: { userId: req.user.id } });
    const stock = {};
    for (const r of rows) stock[r.itemType] = r.count;
    res.json({ stock });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/craft/equipment/:id/enhance
 * 강화 아이템 1개 소모 → 장비 스탯 강화
 * body: { itemType: 'stone_common' | 'stone_rare' | 'crystal_magic' | 'shard_legend' }
 */
router.post('/equipment/:id/enhance', requireAuth, async (req, res, next) => {
  try {
    const id       = String(req.params.id || '').trim();
    const itemType = String(req.body?.itemType || '').trim();
    const meta     = ENHANCE_ITEM_META[itemType];
    if (!id || !meta) return res.status(400).json({ error: { message: '잘못된 요청입니다.' } });

    const [equip, stockRow] = await Promise.all([
      prisma.craftedEquipment.findUnique({ where: { id } }),
      prisma.enhancementStock.findUnique({
        where: { userId_itemType: { userId: req.user.id, itemType } },
      }),
    ]);
    if (!equip || equip.userId !== req.user.id)
      return res.status(404).json({ error: { message: '장비를 찾을 수 없습니다.' } });
    if (!stockRow || stockRow.count < 1)
      return res.status(400).json({ error: { message: '강화 아이템이 부족합니다.' } });

    const success = Math.random() < meta.successRate;

    const result = await prisma.$transaction(async (tx) => {
      // 아이템 1개 소모
      const upd = await tx.enhancementStock.updateMany({
        where: { userId: req.user.id, itemType, count: { gte: 1 } },
        data:  { count: { decrement: 1 } },
      });
      if (upd.count !== 1) throw Object.assign(new Error('STOCK_GONE'), {});

      if (!success) return { success: false };

      const stats = { ...(equip.stats || {}) };
      if (meta.mode === 'random_primary') {
        // 공격 or 방어 중 랜덤 하나에 amount 추가
        if (Math.random() < 0.5) stats.attackBonus  = (stats.attackBonus  || 0) + meta.amount;
        else                     stats.defenseBonus = (stats.defenseBonus || 0) + meta.amount;
      } else {
        const b = meta.bonuses;
        if (b.atk) stats.attackBonus  = (stats.attackBonus  || 0) + b.atk;
        if (b.def) stats.defenseBonus = (stats.defenseBonus || 0) + b.def;
        if (b.spd) stats.speedBonus   = Number(Math.min(0.5, (stats.speedBonus || 0) + b.spd).toFixed(3));
        if (b.hp)  stats.hpBonus      = (stats.hpBonus      || 0) + b.hp;
      }
      const newEquip = await tx.craftedEquipment.update({ where: { id }, data: { stats } });
      return { success: true, stats: newEquip.stats };
    });

    res.json({ ok: true, success: result.success, stats: result.stats || null });
  } catch (err) {
    if (err.message === 'STOCK_GONE')
      return res.status(400).json({ error: { message: '강화 아이템이 부족합니다.' } });
    next(err);
  }
});

module.exports = router;
