'use strict';

/**
 * 재료 catch id + 레시피 등급으로 결정론적 능력치 (같은 id 집합이면 동일 분포 경향).
 */
function rollEquipmentStats(tier, catchIds) {
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
  let state = (seed ^ 0x9e3779b9) >>> 0;
  function next() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  }

  const base = 3 + Math.floor(next() * 8) * tierMul;
  return {
    attackBonus: Math.round(base + next() * 6 * tierMul),
    defenseBonus: Math.round(base * 0.6 + next() * 5 * tierMul),
    speedBonus: Number((0.02 + next() * 0.06 * tierMul).toFixed(3)),
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
