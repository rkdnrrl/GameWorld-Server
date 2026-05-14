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

const router = Router();

const DYNAMIC_RECIPE_ID = 'dynamic';
const MAX_DYNAMIC_MATERIALS = 12;
/** 모루에서 산출물만으로 제련 시 최소 개수 */
const MIN_SMELT_MATERIALS_FOR_FORGE = 1;
/** 실패 시 재료 반환 비율 (25~60%) */
const FAIL_RETURN_RATE_MIN = 0.25;
const FAIL_RETURN_RATE_MAX = 0.60;

// 9-슬롯 그리드 위치별 스탯 배율 (1.0=기준, >1.0=증가, <1.0=감소)
// 상단행: 공격·속도 특화 — 방어·HP 손실
// 중단행: 방어 특화 — 공격·속도 손실
// 하단행: HP·내구 특화 — 공격 손실
const GRID_POSITION_WEIGHTS = [
  { atk: 1.8, def: 0.4, spd: 1.2, hp: 0.3, durScale: 0.7 }, // 0: 상단 좌 — 공격↑  방어·HP↓
  { atk: 0.8, def: 0.5, spd: 2.0, hp: 0.4, durScale: 0.8 }, // 1: 상단 중 — 속도↑  방어·HP↓
  { atk: 1.8, def: 0.4, spd: 1.2, hp: 0.3, durScale: 0.7 }, // 2: 상단 우 — 공격↑  방어·HP↓
  { atk: 0.4, def: 1.8, spd: 0.5, hp: 1.0, durScale: 1.1 }, // 3: 중단 좌 — 방어↑  공격·속도↓
  { atk: 1.0, def: 1.0, spd: 1.0, hp: 1.0, durScale: 1.3 }, // 4: 중앙   — 균형    내구↑
  { atk: 0.4, def: 1.8, spd: 0.5, hp: 1.0, durScale: 1.1 }, // 5: 중단 우 — 방어↑  공격·속도↓
  { atk: 0.3, def: 0.8, spd: 0.6, hp: 2.0, durScale: 0.8 }, // 6: 하단 좌 — HP↑   공격·속도↓
  { atk: 0.5, def: 0.9, spd: 0.7, hp: 1.5, durScale: 1.5 }, // 7: 하단 중 — HP↑내구↑  공격↓
  { atk: 0.3, def: 0.8, spd: 0.6, hp: 2.0, durScale: 0.8 }, // 8: 하단 우 — HP↑   공격·속도↓
];

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

    // 그리드 위치 기반 스탯 가중치 계산
    const _acc = { atk: 0, def: 0, spd: 0, hp: 0, durScale: 0 };
    for (const m of materials) {
      const gw = GRID_POSITION_WEIGHTS[m.slotIndex] || GRID_POSITION_WEIGHTS[0];
      _acc.atk += gw.atk; _acc.def += gw.def; _acc.spd += gw.spd;
      _acc.hp += gw.hp; _acc.durScale += gw.durScale;
    }
    const _cnt = materials.length || 1;
    const gridW = { atk: _acc.atk / _cnt, def: _acc.def / _cnt, spd: _acc.spd / _cnt, hp: _acc.hp / _cnt, durScale: _acc.durScale / _cnt };
    const _SLOT_EMOJIS = { atk: '⚔️', def: '🛡️', spd: '👟', hp: '❤️', durScale: '🔩' };
    const dominantKey = Object.keys(gridW).sort((a, b) => gridW[b] - gridW[a])[0];
    const itemEmoji = _SLOT_EMOJIS[dominantKey] || '⚒️';
    const slot = { atk: 'weapon', def: 'chest', spd: 'boots', hp: 'head', durScale: 'accessory' }[dominantKey] || 'weapon';

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
      const finalName = '미정';
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

      // 5b. 성공 처리 — 장비 생성
      const rawStats = rollEquipmentStats(tier, rollSlots, profInfo.mul);
      const w = gridW;
      const stats = {
        equipSlot: slot,
        attackBonus:  w.atk > 0 ? Math.max(1, Math.round(rawStats.attackBonus  * w.atk)) : 0,
        defenseBonus: w.def > 0 ? Math.max(1, Math.round(rawStats.defenseBonus * w.def)) : 0,
        speedBonus:   w.spd > 0 ? Number(Math.max(0.01, Math.min(0.5, rawStats.speedBonus * w.spd)).toFixed(3)) : 0,
        durabilityMax: w.durScale > 0 ? Math.max(15, Math.round(rawStats.durabilityMax * w.durScale)) : 0,
        hpBonus: w.hp > 0 ? Math.max(5, Math.round((rawStats.defenseBonus * 3 + rawStats.attackBonus * 0.5) * w.hp)) : 0,
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
          pixelArt: null,
        },
      });
      return {
        success: true,
        equipment: created,
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

module.exports = router;
