const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const { RECIPES } = require('../lib/forgeRecipes');
const { matchingSubsetForRecipe } = require('../lib/forgeValidate');
const { rollEquipmentStats, tierFromCatches } = require('../lib/forgeRollStats');

const router = Router();

const DYNAMIC_RECIPE_ID = 'dynamic';
const MAX_DYNAMIC_MATERIALS = 12;

function toPublicEquipment(r) {
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
    sourceCatchIds: r.sourceCatchIds,
    pixelArt: r.pixelArt,
    createdAt: r.createdAt,
  };
}

function sanitizeText(s, max) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

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
 * A) 레시피 제련: { recipeId, catchIds }
 * B) 동적 이름 제련(대장간 클라이언트): { catchIds, name, description? } — catchIds 2개 이상
 */
router.post('/equipment', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const recipeIdRaw = body.recipeId;
    const catchIdsIn = body.catchIds;
    const nameIn = body.name;
    const descIn = body.description;

    const catchIds = Array.isArray(catchIdsIn)
      ? catchIdsIn.map((x) => String(x).trim()).filter(Boolean)
      : [];

    const hasRecipe =
      recipeIdRaw != null &&
      String(recipeIdRaw).trim() !== '' &&
      String(recipeIdRaw).trim() !== DYNAMIC_RECIPE_ID;
    const hasDynamic =
      catchIds.length >= 2 &&
      nameIn != null &&
      String(nameIn).trim().length > 0;

    if (!hasRecipe && !hasDynamic) {
      return res.status(400).json({
        error: {
          message:
            'recipeId+catchIds(레시피 제련) 또는 catchIds(2개 이상)+name(동적 제련)이 필요합니다.',
        },
      });
    }

    if (hasDynamic && catchIds.length > MAX_DYNAMIC_MATERIALS) {
      return res.status(400).json({
        error: { message: `재료는 최대 ${MAX_DYNAMIC_MATERIALS}개까지입니다.` },
      });
    }

    const idSet = new Set(catchIds);
    if (idSet.size !== catchIds.length) {
      return res.status(400).json({ error: { message: '중복된 재료 id가 있습니다.' } });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const rows = await tx.catch.findMany({
        where: {
          id: { in: [...idSet] },
          userId: req.user.id,
          sold: false,
        },
      });

      if (rows.length !== catchIds.length) {
        return { err: 'NOT_FOUND_OR_SOLD' };
      }

      let rec = null;
      let finalName;
      let finalDesc;
      let itemEmoji;
      let tier;
      let recipeIdStored;

      if (hasRecipe) {
        const recipeId = String(recipeIdRaw).trim();
        rec = RECIPES.find((r) => r.id === recipeId);
        if (!rec || !rec.need || !rec.out) {
          return { err: 'UNKNOWN_RECIPE' };
        }
        if (catchIds.length !== rec.need.length) {
          return { err: 'COUNT_MISMATCH' };
        }

        const mats = rows.map((c) => ({
          id: c.id,
          name: c.itemName,
          pixelArt: c.pixelArt,
        }));

        const used = matchingSubsetForRecipe(rec, mats);
        if (!used) {
          return { err: 'RECIPE_MISMATCH' };
        }
        const usedIds = new Set(used.map((u) => u.id));
        for (const id of catchIds) {
          if (!usedIds.has(id)) {
            return { err: 'RECIPE_MISMATCH' };
          }
        }

        recipeIdStored = rec.id;
        finalName = rec.out.name;
        finalDesc = rec.out.desc ? String(rec.out.desc).slice(0, 400) : null;
        itemEmoji = (rec.out.emoji && String(rec.out.emoji).slice(0, 16)) || '⚔️';
        tier = String(rec.out.tier || 'common').slice(0, 20);
      } else {
        recipeIdStored = DYNAMIC_RECIPE_ID;
        finalName = sanitizeText(nameIn, 120);
        if (!finalName) {
          return { err: 'BAD_NAME' };
        }
        finalDesc = descIn != null ? sanitizeText(descIn, 400) : null;
        if (!finalDesc) {
          finalDesc = `${catchIds.length}가지 재료를 섞어 제련했습니다.`.slice(0, 400);
        }
        const firstEmoji = rows[0] && rows[0].itemEmoji ? String(rows[0].itemEmoji).slice(0, 16) : '⚔️';
        itemEmoji = firstEmoji || '⚔️';
        tier = tierFromCatches(rows);
      }

      const idToRow = new Map(rows.map((r) => [r.id, r]));
      const sizesOrdered = catchIds.map((id) => {
        const r = idToRow.get(id);
        return r && r.size != null && Number.isFinite(Number(r.size)) ? Number(r.size) : null;
      });
      const stats = rollEquipmentStats(tier, catchIds, sizesOrdered);
      const firstArt =
        rows.find((u) => u.pixelArt != null)?.pixelArt ?? null;

      await tx.catch.deleteMany({
        where: {
          id: { in: [...idSet] },
          userId: req.user.id,
        },
      });

      const created = await tx.craftedEquipment.create({
        data: {
          userId: req.user.id,
          recipeId: String(recipeIdStored).slice(0, 64),
          name: String(finalName).slice(0, 120),
          itemEmoji,
          tier: String(tier || 'common').slice(0, 20),
          desc: finalDesc,
          stats,
          sourceCatchIds: catchIds,
          pixelArt: firstArt,
        },
      });
      return { equipment: created };
    });

    if (outcome.err === 'NOT_FOUND_OR_SOLD') {
      return res.status(400).json({
        error: { message: '재료를 찾을 수 없거나 이미 판매된 항목입니다.' },
      });
    }
    if (outcome.err === 'UNKNOWN_RECIPE') {
      return res.status(400).json({ error: { message: '알 수 없는 레시피입니다.' } });
    }
    if (outcome.err === 'COUNT_MISMATCH') {
      return res.status(400).json({ error: { message: '재료 개수가 레시피와 맞지 않습니다.' } });
    }
    if (outcome.err === 'RECIPE_MISMATCH') {
      return res.status(400).json({
        error: { message: '재료 조합이 선택한 레시피와 맞지 않습니다.' },
      });
    }
    if (outcome.err === 'BAD_NAME') {
      return res.status(400).json({ error: { message: '장비 이름이 비어 있습니다.' } });
    }

    const equipment = outcome.equipment;
    res.status(201).json({ equipment: toPublicEquipment(equipment) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
