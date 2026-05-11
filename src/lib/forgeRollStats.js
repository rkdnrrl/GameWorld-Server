'use strict';

/** 장비 재료는 낚시 size 대역에 맞춘 가상 크기(티어 기반) */
function pseudoSizeFromEquipmentTier(tier) {
  const t = String(tier || 'common').toLowerCase();
  if (t === 'legendary') return 34;
  if (t === 'epic') return 26;
  if (t === 'rare') return 18;
  return 12;
}

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

  const sizesIn = slots.map((m) => {
    if (m.kind === 'equipment') {
      return pseudoSizeFromEquipmentTier(m.tier);
    }
    const z = m.size;
    return z != null && Number.isFinite(Number(z)) && Number(z) > 0 ? Number(z) : null;
  });

  for (let si = 0; si < sizesIn.length; si += 1) {
    const v = sizesIn[si];
    if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) {
      const n = Math.round(Number(v) * 1000) >>> 0;
      seed = (seed + n + si * 17) >>> 0;
    }
  }

  const validSizes = sizesIn.filter((v) => v != null && Number.isFinite(Number(v)) && Number(v) > 0);

  let avgSourceSize = null;
  let maxSourceSize = null;
  /** 평균·최대 size 로 배율 (낚시 size 대략 3~38 구간 가정) */
  let sizeMul = 1;
  let maxBoost = 1;
  if (validSizes.length > 0) {
    const sum = validSizes.reduce((a, b) => a + b, 0);
    const avg = sum / validSizes.length;
    avgSourceSize = Number(avg.toFixed(2));
    maxSourceSize = Math.max(...validSizes);
    const lo = 3;
    const hi = 38;
    const clamped = Math.min(hi, Math.max(lo, avg));
    sizeMul = 0.9 + ((clamped - lo) / (hi - lo)) * 0.28;
    const mx = Math.min(hi, Math.max(lo, maxSourceSize));
    maxBoost = 1 + ((mx - lo) / (hi - lo)) * 0.1;
  }

  const effectiveMul = tierMul * sizeMul * maxBoost;

  let state = (seed ^ 0x9e3779b9) >>> 0;
  function next() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  }

  const base = 3 + Math.floor(next() * 8) * effectiveMul;
  return {
    attackBonus: Math.round(base + next() * 6 * effectiveMul),
    defenseBonus: Math.round(base * 0.6 + next() * 5 * effectiveMul),
    speedBonus: Number((0.02 + next() * 0.06 * effectiveMul).toFixed(3)),
    avgSourceSize,
    maxSourceSize,
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
  pseudoSizeFromEquipmentTier,
};
