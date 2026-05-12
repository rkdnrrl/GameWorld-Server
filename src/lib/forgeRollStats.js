'use strict';

/**
 * 재료 슬롯(catch·장비) + 결과 티어로 결정론적 능력치.
 * @param {string} tier — 결과 장비 롤에 쓰는 배율 티어
 * @param {{ kind: 'catch'|'equipment', id: string, size?: number|null, tier?: string }[]} materialSlots
 */
function rollEquipmentStats(tier, materialSlots) {
  const slots = Array.isArray(materialSlots) ? materialSlots : [];
  const t = String(tier || 'common').toLowerCase();
  const tierMul =
    t === 'legendary' ? 2.2 :
    t === 'epic' ? 1.7 :
    t === 'rare' ? 1.35 :
    1;

  const seedTokens = slots.map((m) => `${m.kind === 'equipment' ? 'e' : 'c'}:${String(m.id)}`);

  let seed = 0;
  for (const tok of [...seedTokens].sort()) {
    const s = String(tok);
    for (let i = 0; i < s.length; i += 1) {
      seed = (Math.imul(seed, 33) + s.charCodeAt(i)) >>> 0;
    }
  }

  /** 재료 크기·낚시 size는 능력치에 반영하지 않음 — 티어·재료 id 시드만 사용 */
  const effectiveMul = tierMul;

  let state = (seed ^ 0x9e3779b9) >>> 0;
  function next() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  }

  const base = 3 + Math.floor(next() * 8) * effectiveMul;
  const durabilityMax = Math.max(28, Math.round(48 + next() * 85 * effectiveMul));
  return {
    attackBonus: Math.round(base + next() * 6 * effectiveMul),
    defenseBonus: Math.round(base * 0.6 + next() * 5 * effectiveMul),
    speedBonus: Number((0.02 + next() * 0.06 * effectiveMul).toFixed(3)),
    durabilityMax,
    durability: durabilityMax,
  };
}

/** catch·제작 장비 재료에서 가장 높은 등급을 결과 롤 티어로 사용 */
function tierFromMaterials(slots) {
  const order = { common: 0, rare: 1, epic: 2, legendary: 3 };
  let best = 0;
  for (const r of slots || []) {
    const raw =
      r.kind === 'equipment'
        ? (r.tier || r.rarity || 'common')
        : (r.rarity || r.tier || 'common');
    const t = String(raw || 'common').toLowerCase();
    const v = Object.prototype.hasOwnProperty.call(order, t) ? order[t] : 0;
    if (v > best) best = v;
  }
  return ['common', 'rare', 'epic', 'legendary'][best];
}

/** @deprecated 레거시 — catch 행만 넘길 때 */
function tierFromCatches(rows) {
  return tierFromMaterials(
    (rows || []).map((r) => ({
      kind: 'catch',
      id: r.id,
      rarity: r.rarity,
    })),
  );
}

module.exports = {
  rollEquipmentStats,
  tierFromCatches,
  tierFromMaterials,
};
