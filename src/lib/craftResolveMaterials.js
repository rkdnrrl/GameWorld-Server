'use strict';

/**
 * 제작 요청의 materials 를 DB 행으로 풀어 순서 유지.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {string} userId
 * @param {{ kind: 'catch'|'equipment', id: string }[]} materials
 * @returns {Promise<{ err: string } | { resolved: object[] }>}
 */
async function resolveCraftMaterials(db, userId, materials) {
  const catchIdsNeeded = [...new Set(materials.filter((m) => m.kind === 'catch').map((m) => m.id))];
  const equipIdsNeeded = [...new Set(materials.filter((m) => m.kind === 'equipment').map((m) => m.id))];

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

  return { resolved };
}

module.exports = { resolveCraftMaterials };
