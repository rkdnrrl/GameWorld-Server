const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const { RECIPES } = require('../lib/forgeRecipes');
const { matchingSubsetForRecipe } = require('../lib/forgeValidate');
const { rollEquipmentStats, tierFromMaterials } = require('../lib/forgeRollStats');

const router = Router();

const DYNAMIC_RECIPE_ID = 'dynamic';
const MAX_DYNAMIC_MATERIALS = 12;

function normalizeSourceMaterialsJson(raw) {
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
  }
  return out;
}

function toPublicEquipment(r) {
  const sourceMaterials = normalizeSourceMaterialsJson(r.sourceCatchIds);
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

function sanitizeText(s, max) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

/**
 * 요청 본문에서 { kind, id }[] 정규화. 레거시 catchIds 만 있으면 전부 catch.
 * @param {object} body
 * @returns {{ kind: 'catch'|'equipment', id: string }[]}
 */
function materialsFromBody(body) {
  const b = body || {};
  if (Array.isArray(b.materials) && b.materials.length > 0) {
    const out = [];
    for (const x of b.materials) {
      if (!x || typeof x !== 'object') continue;
      const id = x.id != null ? String(x.id).trim() : '';
      if (!id) continue;
      const k = String(x.kind || x.type || '').toLowerCase();
      if (k === 'catch' || k === 'fish' || k === 'c') out.push({ kind: 'catch', id });
      else if (k === 'equipment' || k === 'equip' || k === 'crafted' || k === 'e') {
        out.push({ kind: 'equipment', id });
      }
    }
    return out;
  }
  const catchIdsIn = b.catchIds;
  if (!Array.isArray(catchIdsIn)) return [];
  return catchIdsIn
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((id) => ({ kind: 'catch', id }));
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
 * A) 레시피 제련: { recipeId, catchIds } 또는 { recipeId, materials }
 * B) 동적 제련: { catchIds, name, description? } 또는 { materials, name, description? } — 재료 2개 이상
 */
router.post('/equipment', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const recipeIdRaw = body.recipeId;
    const nameIn = body.name;
    const descIn = body.description;

    const materials = materialsFromBody(body);
    const fingerprint = materials.map((m) => `${m.kind}:${m.id}`);
    const fpSet = new Set(fingerprint);
    if (fpSet.size !== materials.length) {
      return res.status(400).json({ error: { message: '중복된 재료가 있습니다.' } });
    }

    const hasRecipe =
      recipeIdRaw != null &&
      String(recipeIdRaw).trim() !== '' &&
      String(recipeIdRaw).trim() !== DYNAMIC_RECIPE_ID;
    const hasDynamic =
      materials.length >= 2 && nameIn != null && String(nameIn).trim().length > 0;

    if (!hasRecipe && !hasDynamic) {
      return res.status(400).json({
        error: {
          message:
            'recipeId+재료(레시피 제련) 또는 재료 2개 이상+name(동적 제련)이 필요합니다. 재료는 materials 또는 catchIds 로 보낼 수 있습니다.',
        },
      });
    }

    if (hasDynamic && materials.length > MAX_DYNAMIC_MATERIALS) {
      return res.status(400).json({
        error: { message: `재료는 최대 ${MAX_DYNAMIC_MATERIALS}개까지입니다.` },
      });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const catchIdsNeeded = [...new Set(materials.filter((m) => m.kind === 'catch').map((m) => m.id))];
      const equipIdsNeeded = [...new Set(materials.filter((m) => m.kind === 'equipment').map((m) => m.id))];

      const catchRows =
        catchIdsNeeded.length > 0
          ? await tx.catch.findMany({
              where: {
                id: { in: catchIdsNeeded },
                userId: req.user.id,
                sold: false,
              },
            })
          : [];
      const equipRows =
        equipIdsNeeded.length > 0
          ? await tx.craftedEquipment.findMany({
              where: {
                id: { in: equipIdsNeeded },
                userId: req.user.id,
              },
            })
          : [];

      if (catchRows.length !== catchIdsNeeded.length) {
        return { err: 'NOT_FOUND_OR_SOLD' };
      }
      if (equipRows.length !== equipIdsNeeded.length) {
        return { err: 'NOT_FOUND_EQUIPMENT' };
      }

      const catchMap = new Map(catchRows.map((r) => [r.id, r]));
      const equipMap = new Map(equipRows.map((r) => [r.id, r]));

      const resolved = [];
      for (const m of materials) {
        if (m.kind === 'catch') {
          const r = catchMap.get(m.id);
          if (!r) return { err: 'NOT_FOUND_OR_SOLD' };
          resolved.push({
            kind: 'catch',
            id: r.id,
            itemName: r.itemName,
            itemEmoji: r.itemEmoji,
            rarity: r.rarity,
            size: r.size,
            pixelArt: r.pixelArt,
          });
        } else {
          const r = equipMap.get(m.id);
          if (!r) return { err: 'NOT_FOUND_EQUIPMENT' };
          resolved.push({
            kind: 'equipment',
            id: r.id,
            name: r.name,
            itemEmoji: r.itemEmoji,
            tier: r.tier,
            rarity: r.tier,
            pixelArt: r.pixelArt,
            stats: r.stats,
          });
        }
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
        if (materials.length !== rec.need.length) {
          return { err: 'COUNT_MISMATCH' };
        }

        const mats = resolved.map((c) => ({
          id: c.id,
          name: c.kind === 'catch' ? c.itemName : c.name,
          pixelArt: c.pixelArt,
        }));

        const used = matchingSubsetForRecipe(rec, mats);
        if (!used) {
          return { err: 'RECIPE_MISMATCH' };
        }
        const usedIds = new Set(used.map((u) => u.id));
        for (const r of resolved) {
          if (!usedIds.has(r.id)) {
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
          finalDesc = `${materials.length}가지 재료를 섞어 제련했습니다.`.slice(0, 400);
        }
        const firstEmojiRow = resolved.find((u) => u.itemEmoji);
        const firstEmoji =
          firstEmojiRow && firstEmojiRow.itemEmoji ? String(firstEmojiRow.itemEmoji).slice(0, 16) : '⚔️';
        itemEmoji = firstEmoji || '⚔️';
        tier = tierFromMaterials(resolved);
      }

      const rollSlots = resolved.map((r) =>
        r.kind === 'catch'
          ? { kind: 'catch', id: r.id, size: r.size, tier: r.rarity }
          : { kind: 'equipment', id: r.id, tier: r.tier },
      );
      const stats = rollEquipmentStats(tier, rollSlots);
      const firstArt = resolved.find((u) => u.pixelArt != null)?.pixelArt ?? null;

      if (catchIdsNeeded.length > 0) {
        await tx.catch.deleteMany({
          where: {
            id: { in: catchIdsNeeded },
            userId: req.user.id,
          },
        });
      }
      if (equipIdsNeeded.length > 0) {
        await tx.craftedEquipment.deleteMany({
          where: {
            id: { in: equipIdsNeeded },
            userId: req.user.id,
          },
        });
      }

      const sourceStored = materials.map((m) => ({ kind: m.kind, id: m.id }));

      const created = await tx.craftedEquipment.create({
        data: {
          userId: req.user.id,
          recipeId: String(recipeIdStored).slice(0, 64),
          name: String(finalName).slice(0, 120),
          itemEmoji,
          tier: String(tier || 'common').slice(0, 20),
          desc: finalDesc,
          stats,
          sourceCatchIds: sourceStored,
          pixelArt: firstArt,
        },
      });
      return { equipment: created };
    });

    if (outcome.err === 'NOT_FOUND_OR_SOLD') {
      return res.status(400).json({
        error: { message: '낚시 재료를 찾을 수 없거나 이미 판매된 항목입니다.' },
      });
    }
    if (outcome.err === 'NOT_FOUND_EQUIPMENT') {
      return res.status(400).json({
        error: { message: '재료로 쓸 장비를 찾을 수 없습니다.' },
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
