'use strict';

/**
 * 재료 catch id + 등급 + (선택) 재료 size 로 결정론적 능력치.
 * @param {string} tier
 * @param {string[]} catchIds
 * @param {(number|null|undefined)[]} [materialSizes] — catchIds 와 같은 순서·길이 권장
 */
function rollEquipmentStats(tier, catchIds, materialSizes) {
  const t = String(tier || 'common').toLowerCase();
  const tierMul =
    t === 'legendary' ? 2.2 :
    t === 'epic' ? 1.7 :
    t === 'rare' ? 1.35 :
    1;

  let seed = 0;
  for (const id of [...catchIds].sort()) {
    const s = String(id);
    for (let i = 0; i < s.length; i += 1) {
      seed = (Math.imul(seed, 33) + s.charCodeAt(i)) >>> 0;
    }
  }

  const sizesIn = Array.isArray(materialSizes) ? materialSizes : [];
  for (let si = 0; si < sizesIn.length; si += 1) {
    const v = sizesIn[si];
    if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) {
      const n = Math.round(Number(v) * 1000) >>> 0;
      seed = (seed + n + si * 17) >>> 0;
    }
  }

  const validSizes = catchIds.map((_, i) => {
    const v = sizesIn[i];
    return v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
  }).filter((x) => x != null);

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

/** 재료 Catch 행들의 rarity 중 가장 높은 등급을 장비 롤 티어로 사용 */
function tierFromCatches(rows) {
  const order = { common: 0, rare: 1, epic: 2, legendary: 3 };
  let best = 0;
  for (const r of rows) {
    const t = String(r.rarity || 'common').toLowerCase();
    const v = Object.prototype.hasOwnProperty.call(order, t) ? order[t] : 0;
    if (v > best) best = v;
  }
  return ['common', 'rare', 'epic', 'legendary'][best];
}

module.exports = { rollEquipmentStats, tierFromCatches };
