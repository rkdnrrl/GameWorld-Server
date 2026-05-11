const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const { RECIPES } = require('../lib/forgeRecipes');
const { matchingSubsetForRecipe } = require('../lib/forgeValidate');
const { rollEquipmentStats } = require('../lib/forgeRollStats');

const router = Router();

/**
 * POST /api/craft/equipment
 * body: { recipeId: string, catchIds: string[] }
 * — 미판매 Catch 재료를 소모하고 장비 1행 생성
 */
router.post('/equipment', requireAuth, async (req, res, next) => {
  try {
    const { recipeId, catchIds } = req.body || {};
    if (!recipeId || typeof recipeId !== 'string') {
      return res.status(400).json({ error: { message: 'recipeId가 필요합니다.' } });
    }
    if (!Array.isArray(catchIds) || catchIds.length === 0) {
      return res.status(400).json({ error: { message: 'catchIds 배열이 필요합니다.' } });
    }

    const rec = RECIPES.find((r) => r.id === recipeId);
    if (!rec || !rec.need || !rec.out) {
      return res.status(400).json({ error: { message: '알 수 없는 레시피입니다.' } });
    }

    if (catchIds.length !== rec.need.length) {
      return res.status(400).json({ error: { message: '재료 개수가 레시피와 맞지 않습니다.' } });
    }

    const idSet = new Set(catchIds.map((x) => String(x)));
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

      const stats = rollEquipmentStats(rec.out.tier, catchIds);
      const firstArt = used.find((u) => u.pixelArt != null)?.pixelArt ?? null;

      await tx.catch.deleteMany({
        where: {
          id: { in: [...idSet] },
          userId: req.user.id,
        },
      });

      const created = await tx.craftedEquipment.create({
        data: {
          userId: req.user.id,
          recipeId: rec.id,
          name: rec.out.name,
          itemEmoji: (rec.out.emoji && String(rec.out.emoji).slice(0, 16)) || '⚔️',
          tier: String(rec.out.tier || 'common').slice(0, 20),
          desc: rec.out.desc ? String(rec.out.desc).slice(0, 400) : null,
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
    if (outcome.err === 'RECIPE_MISMATCH') {
      return res.status(400).json({
        error: { message: '재료 조합이 선택한 레시피와 맞지 않습니다.' },
      });
    }

    const equipment = outcome.equipment;
    res.status(201).json({
      equipment: {
        id: equipment.id,
        recipeId: equipment.recipeId,
        name: equipment.name,
        itemEmoji: equipment.itemEmoji,
        tier: equipment.tier,
        desc: equipment.desc,
        stats: equipment.stats,
        sourceCatchIds: equipment.sourceCatchIds,
        pixelArt: equipment.pixelArt,
        createdAt: equipment.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
