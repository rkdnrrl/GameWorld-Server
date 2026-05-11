const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const { RECIPES } = require('../lib/forgeRecipes');
const { matchingSubsetForRecipe } = require('../lib/forgeValidate');
const { rollEquipmentStats, tierFromMaterials, materialSizeSummary } = require('../lib/forgeRollStats');
const { resolveCraftMaterials } = require('../lib/craftResolveMaterials');
const { heuristicEquipmentNameFromResolved } = require('../lib/forgeHeuristicName');
const { generateForgeEquipmentBundleFromMaterials } = require('../lib/geminiEquipmentName');
const { generateCraftedEquipmentPixelArt } = require('../lib/pixelLabEquipmentArt');

const router = Router();

const DYNAMIC_RECIPE_ID = 'dynamic';
const MAX_DYNAMIC_MATERIALS = 12;
const MIN_SMELT_MATERIALS_FOR_FORGE = 5;
const GEMINI_NAME_TIMEOUT_MS = 12_000;
/** PixelLab 장비 스프라이트 — 긴 호출이므로 트랜잭션 밖에서만 */
const PIXELLAB_FORGE_MS = 110_000;
const SHARED_FORGE_EQUIP_PREFIX = 'shared:forge-equip:';

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
      else if (k === 'smelt' || k === 'stock' || k === 's') out.push({ kind: 'smelt', id });
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

function sharedForgeEquipCacheKey(name, tier) {
  const t = String(tier || 'common').trim().toLowerCase().slice(0, 20) || 'common';
  const n = String(name || '').trim();
  const base = `${SHARED_FORGE_EQUIP_PREFIX}${t}:`;
  const maxLen = Math.max(1, 100 - base.length);
  return `${base}${n.slice(0, maxLen)}`;
}

/**
 * 요청 본문에서 { kind, id }[] 정규화. 레거시 catchIds 만 있으면 전부 catch.
 * @param {object} body
 * @returns {{ kind: 'catch'|'equipment'|'smelt', id: string }[]}
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
      } else if (k === 'smelt' || k === 'stock' || k === 's') {
        out.push({ kind: 'smelt', id });
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
 * A) 레시피 제련: { recipeId, materials | catchIds }
 * B) 동적 제련: materials(2+) + (name | generateNameWithAi)
 *    — generateNameWithAi: true 이면 Gemini 로 이름+능력치+내구도(JSON), 실패 시 롤/클라이언트 name
 */
router.post('/equipment', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const recipeIdRaw = body.recipeId;
    const nameIn = body.name;
    const descIn = body.description;
    const wantAiName = Boolean(body.generateNameWithAi || body.aiEquipmentName);

    const materials = materialsFromBody(body);
    const smeltCount = materials.filter((m) => m.kind === 'smelt').length;
    if (smeltCount > 0 && smeltCount < MIN_SMELT_MATERIALS_FOR_FORGE) {
      return res.status(400).json({
        error: {
          message: `산출물을 제련 재료로 쓰려면 최소 ${MIN_SMELT_MATERIALS_FOR_FORGE}개가 필요합니다.`,
        },
      });
    }
    const fingerprint = materials.filter((m) => m.kind !== 'smelt').map((m) => `${m.kind}:${m.id}`);
    const fpSet = new Set(fingerprint);
    if (fpSet.size !== fingerprint.length) {
      return res.status(400).json({ error: { message: '중복된 재료가 있습니다.' } });
    }

    const nameTrim = nameIn != null ? String(nameIn).trim() : '';
    const hasClientName = nameTrim.length > 0;

    const hasRecipe =
      recipeIdRaw != null &&
      String(recipeIdRaw).trim() !== '' &&
      String(recipeIdRaw).trim() !== DYNAMIC_RECIPE_ID;
    const hasDynamic = materials.length >= 2 && (hasClientName || wantAiName);

    if (!hasRecipe && !hasDynamic) {
      return res.status(400).json({
        error: {
          message:
            'recipeId+재료(레시피 제련) 또는 재료 2개 이상 + (name 또는 generateNameWithAi) 가 필요합니다.',
        },
      });
    }

    if (hasDynamic && materials.length > MAX_DYNAMIC_MATERIALS) {
      return res.status(400).json({
        error: { message: `재료는 최대 ${MAX_DYNAMIC_MATERIALS}개까지입니다.` },
      });
    }

    /** 동적 제련 + AI: 트랜잭션 전에 재료 조회·Gemini(이름+스탯+내구) (DB 락 최소화) */
    let precomputedAiBundle = null;
    if (hasDynamic && wantAiName) {
      const preview = await resolveCraftMaterials(prisma, req.user.id, materials);
      if (preview.err === 'NOT_FOUND_OR_SOLD') {
        return res.status(400).json({
          error: { message: '낚시 재료를 찾을 수 없거나 이미 판매된 항목입니다.' },
        });
      }
      if (preview.err === 'NOT_FOUND_EQUIPMENT') {
        return res.status(400).json({
          error: { message: '재료로 쓸 장비를 찾을 수 없습니다.' },
        });
      }
      if (preview.err === 'NOT_ENOUGH_SMELT') {
        return res.status(400).json({
          error: { message: '산출물 재고가 부족합니다.' },
        });
      }
      const tierPv = tierFromMaterials(preview.resolved);
      const rollSlotsPreview = preview.resolved.map((r) =>
        r.kind === 'catch'
          ? { kind: 'catch', id: r.id, size: r.size, tier: r.rarity }
          : r.kind === 'equipment'
            ? { kind: 'equipment', id: r.id, tier: r.tier }
            : { kind: 'smelt', id: r.id, size: r.size, tier: r.rarity },
      );
      const sizeExtra = materialSizeSummary(rollSlotsPreview);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), GEMINI_NAME_TIMEOUT_MS);
      try {
        const ai = await generateForgeEquipmentBundleFromMaterials({
          resolved: preview.resolved,
          tier: tierPv,
          signal: ac.signal,
          sizeExtra,
        });
        if (ai.name && ai.stats) {
          precomputedAiBundle = {
            name: ai.name,
            stats: ai.stats,
            nameClass: ai.nameClass === 'signature' ? 'signature' : 'ordinary',
          };
        }
      } catch {
        /* Gemini 실패 시 트랜잭션에서 롤·클라이언트 name */
      } finally {
        clearTimeout(timer);
      }
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const load = await resolveCraftMaterials(tx, req.user.id, materials);
      if (load.err) return { err: load.err };
      const { resolved } = load;

      const catchIdsNeeded = [...new Set(materials.filter((m) => m.kind === 'catch').map((m) => m.id))];
      const equipIdsNeeded = [...new Set(materials.filter((m) => m.kind === 'equipment').map((m) => m.id))];
      const smeltNeedById = {};
      for (const m of materials) {
        if (m.kind !== 'smelt') continue;
        const sid = String(m.id || '').trim();
        if (!sid) continue;
        smeltNeedById[sid] = (smeltNeedById[sid] || 0) + 1;
      }

      let rec = null;
      let finalName;
      let finalDesc;
      let itemEmoji;
      let tier;
      let recipeIdStored;
      let nameSource;

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
        nameSource = 'recipe';
      } else {
        recipeIdStored = DYNAMIC_RECIPE_ID;
        if (wantAiName && precomputedAiBundle && precomputedAiBundle.name) {
          finalName = sanitizeText(precomputedAiBundle.name, 120);
          nameSource = 'ai';
        } else if (hasClientName) {
          finalName = sanitizeText(nameTrim, 120);
          nameSource = wantAiName ? 'client_fallback' : 'client';
        } else {
          finalName = sanitizeText(heuristicEquipmentNameFromResolved(resolved), 120);
          nameSource = 'heuristic';
        }
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
          : r.kind === 'equipment'
            ? { kind: 'equipment', id: r.id, tier: r.tier }
            : { kind: 'smelt', id: r.id, size: r.size, tier: r.rarity },
      );
      let stats;
      if (wantAiName && precomputedAiBundle && precomputedAiBundle.stats) {
        stats = { ...precomputedAiBundle.stats, ...materialSizeSummary(rollSlots) };
      } else {
        stats = rollEquipmentStats(tier, rollSlots);
      }
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
      for (const [productId, usedCountRaw] of Object.entries(smeltNeedById)) {
        const usedCount = Math.max(1, Math.floor(Number(usedCountRaw) || 0));
        const updated = await tx.smeltStock.updateMany({
          where: {
            userId: req.user.id,
            productId,
            count: { gte: usedCount },
          },
          data: {
            count: { decrement: usedCount },
          },
        });
        if (updated.count !== 1) return { err: 'NOT_ENOUGH_SMELT' };
      }
      await tx.smeltStock.deleteMany({
        where: { userId: req.user.id, count: { lte: 0 } },
      });

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
      return { equipment: created, nameSource };
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
    if (outcome.err === 'NOT_ENOUGH_SMELT') {
      return res.status(400).json({
        error: { message: '산출물 재고가 부족합니다.' },
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

    const createdRow = outcome.equipment;
    const artCachePolicy =
      outcome.nameSource === 'ai' && precomputedAiBundle && precomputedAiBundle.nameClass === 'signature'
        ? 'private'
        : 'shared';
    const cacheKey = sharedForgeEquipCacheKey(createdRow.name, createdRow.tier);

    if (artCachePolicy === 'shared') {
      try {
        const cached = await prisma.sharedPixelArt.findUnique({
          where: { name: cacheKey },
          select: { imageData: true },
        });
        if (cached && cached.imageData) {
          await prisma.craftedEquipment.update({
            where: { id: createdRow.id, userId: req.user.id },
            data: {
              pixelArt: {
                source: 'shared_cache',
                cacheKey,
                imageDataUrl: cached.imageData,
              },
            },
          });
          const freshCached = await prisma.craftedEquipment.findUnique({
            where: { id: createdRow.id },
          });
          const payloadCached = { equipment: toPublicEquipment(freshCached || createdRow) };
          if (outcome.nameSource != null) payloadCached.nameSource = outcome.nameSource;
          payloadCached.artCachePolicy = artCachePolicy;
          return res.status(201).json(payloadCached);
        }
      } catch (e) {
        console.warn('[craft/equipment] shared cache lookup skipped:', e && e.message ? e.message : e);
      }
    }

    const pixelAc = new AbortController();
    const pixelTimer = setTimeout(() => pixelAc.abort(), PIXELLAB_FORGE_MS);
    try {
      const png = await generateCraftedEquipmentPixelArt(createdRow.name, createdRow.tier, pixelAc.signal);
      if (png) {
        await prisma.craftedEquipment.update({
          where: { id: createdRow.id, userId: req.user.id },
          data: {
            pixelArt: {
              source: 'pixellab',
              imageDataUrl: png,
            },
          },
        });
        if (artCachePolicy === 'shared') {
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
                type: 'forge_equipment',
              },
            });
          } catch (e) {
            console.warn('[craft/equipment] shared cache save skipped:', e && e.message ? e.message : e);
          }
        }
      }
    } catch (e) {
      console.warn('[craft/equipment] PixelLab sprite skipped:', e && e.message ? e.message : e);
    } finally {
      clearTimeout(pixelTimer);
    }

    const fresh = await prisma.craftedEquipment.findUnique({
      where: { id: createdRow.id },
    });
    const payload = { equipment: toPublicEquipment(fresh || createdRow) };
    if (outcome.nameSource != null) payload.nameSource = outcome.nameSource;
    payload.artCachePolicy = artCachePolicy;
    res.status(201).json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
