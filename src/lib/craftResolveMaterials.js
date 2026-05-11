'use strict';
const { metaForProductId } = require('./smeltProduct');

function smeltTierForProductId(productId) {
  const id = String(productId || '').toLowerCase();
  if (['platinum', 'palladium', 'rhodium', 'iridium', 'uranium', 'diamond'].includes(id)) return 'legendary';
  if (['titanium', 'tungsten', 'rareearth', 'neodymium', 'graphene', 'ruby', 'sapphire', 'emerald'].includes(id)) return 'epic';
  if (['gold', 'silver', 'copper', 'iron', 'glass', 'circuit', 'battery'].includes(id)) return 'rare';
  return 'common';
}

function smeltSizeForTier(tier) {
  const t = String(tier || 'common').toLowerCase();
  if (t === 'legendary') return 30;
  if (t === 'epic') return 24;
  if (t === 'rare') return 18;
  return 12;
}

/**
 * 제작 요청의 materials 를 DB 행으로 풀어 순서 유지.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {string} userId
 * @param {{ kind: 'catch'|'equipment'|'smelt', id: string }[]} materials
 * @returns {Promise<{ err: string } | { resolved: object[] }>}
 */
async function resolveCraftMaterials(db, userId, materials) {
  const catchIdsNeeded = [...new Set(materials.filter((m) => m.kind === 'catch').map((m) => m.id))];
  const equipIdsNeeded = [...new Set(materials.filter((m) => m.kind === 'equipment').map((m) => m.id))];
  const smeltIdsNeeded = [...new Set(materials.filter((m) => m.kind === 'smelt').map((m) => m.id))];
  const smeltNeedCount = {};
  for (const m of materials) {
    if (m.kind !== 'smelt') continue;
    const sid = String(m.id || '').trim();
    if (!sid) continue;
    smeltNeedCount[sid] = (smeltNeedCount[sid] || 0) + 1;
  }

  const catchRows =
    catchIdsNeeded.length > 0
      ? await db.catch.findMany({
          where: {
            id: { in: catchIdsNeeded },
            userId,
            sold: false,
          },
        })
      : [];
  const equipRows =
    equipIdsNeeded.length > 0
      ? await db.craftedEquipment.findMany({
          where: {
            id: { in: equipIdsNeeded },
            userId,
          },
        })
      : [];
  const smeltRows =
    smeltIdsNeeded.length > 0
      ? await db.smeltStock.findMany({
          where: {
            userId,
            productId: { in: smeltIdsNeeded },
          },
        })
      : [];

  if (catchRows.length !== catchIdsNeeded.length) {
    return { err: 'NOT_FOUND_OR_SOLD' };
  }
  if (equipRows.length !== equipIdsNeeded.length) {
    return { err: 'NOT_FOUND_EQUIPMENT' };
  }
  const smeltMap = new Map(smeltRows.map((r) => [String(r.productId), r]));
  for (const sid of smeltIdsNeeded) {
    const row = smeltMap.get(String(sid));
    const need = smeltNeedCount[sid] || 0;
    const has = row && Number.isFinite(Number(row.count)) ? Number(row.count) : 0;
    if (!row || has < need) return { err: 'NOT_ENOUGH_SMELT' };
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
      if (m.kind === 'equipment') {
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
      } else {
        const r = smeltMap.get(String(m.id));
        if (!r) return { err: 'NOT_ENOUGH_SMELT' };
        const meta = metaForProductId(r.productId);
        const tier = smeltTierForProductId(r.productId);
        resolved.push({
          kind: 'smelt',
          id: String(r.productId),
          name: meta.name,
          itemEmoji: meta.emoji,
          rarity: tier,
          tier,
          size: smeltSizeForTier(tier),
          pixelArt: null,
        });
      }
    }
  }

  return { resolved };
}

module.exports = { resolveCraftMaterials };
