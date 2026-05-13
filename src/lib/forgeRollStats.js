'use strict';

/**
 * 대장간 숙련도 단계별 정보.
 * @param {number} totalCrafts — smithingProficiency (총 제련 성공 횟수)
 * @returns {{ tier: number, name: string, mul: number, next: number|null }}
 */
function proficiencyLevelFromCount(totalCrafts) {
  const n = Math.max(0, Math.floor(Number(totalCrafts) || 0));
  if (n < 10)  return { tier: 0, name: '견습 대장장이',    mul: 1.0,  next: 10  };
  if (n < 30)  return { tier: 1, name: '장인 수련',        mul: 1.15, next: 30  };
  if (n < 60)  return { tier: 2, name: '숙련 대장장이',    mul: 1.35, next: 60  };
  if (n < 100) return { tier: 3, name: '명장',             mul: 1.6,  next: 100 };
  return        { tier: 4, name: '전설의 대장장이',         mul: 2.0,  next: null };
}

/**
 * Gemini·rollEquipmentStats 로 얻은 스탯에 숙련도 배율 적용.
 * @param {{ attackBonus, defenseBonus, speedBonus, durabilityMax, durability? }} stats
 * @param {number} profMul
 */
function applyProficiencyToStats(stats, profMul) {
  const m = (typeof profMul === 'number' && Number.isFinite(profMul) && profMul > 0) ? profMul : 1.0;
  if (m <= 1.0) return stats;
  const durMax = Math.max(28, Math.round(stats.durabilityMax * m));
  const dur = stats.durability != null
    ? Math.max(1, Math.round(stats.durability * m))
    : durMax;
  return {
    attackBonus:   Math.round(stats.attackBonus  * m),
    defenseBonus:  Math.round(stats.defenseBonus * m),
    speedBonus:    Number((stats.speedBonus * m).toFixed(3)),
    durabilityMax: durMax,
    durability:    dur,
  };
}

/**
 * 재료 슬롯 + 결과 티어 + 숙련도 배율로 결정론적 능력치.
 * @param {string} tier — 결과 장비 롤에 쓰는 배율 티어
 * @param {{ kind: string, id: string, size?: number|null, tier?: string }[]} materialSlots
 * @param {number} [proficiencyMul=1.0] — 숙련도 배율 (proficiencyLevelFromCount().mul)
 */
function rollEquipmentStats(tier, materialSlots, proficiencyMul) {
  const slots = Array.isArray(materialSlots) ? materialSlots : [];
  const t = String(tier || 'common').toLowerCase();
  const tierMul =
    t === 'legendary' ? 2.2 :
    t === 'epic' ? 1.7 :
    t === 'rare' ? 1.35 :
    1;
  const profMul = (typeof proficiencyMul === 'number' && Number.isFinite(proficiencyMul) && proficiencyMul > 0)
    ? proficiencyMul : 1.0;

  const seedTokens = slots.map((m) => `${m.kind === 'equipment' ? 'e' : 'c'}:${String(m.id)}`);

  let seed = 0;
  for (const tok of [...seedTokens].sort()) {
    const s = String(tok);
    for (let i = 0; i < s.length; i += 1) {
      seed = (Math.imul(seed, 33) + s.charCodeAt(i)) >>> 0;
    }
  }

  const effectiveMul = tierMul * profMul;

  let state = (seed ^ 0x9e3779b9) >>> 0;
  function next() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  }

  const base = 3 + Math.floor(next() * 8) * effectiveMul;
  const durabilityMax = Math.max(28, Math.round(48 + next() * 85 * effectiveMul));
  return {
    attackBonus:  Math.round(base + next() * 6 * effectiveMul),
    defenseBonus: Math.round(base * 0.6 + next() * 5 * effectiveMul),
    speedBonus:   Number((0.02 + next() * 0.06 * effectiveMul).toFixed(3)),
    durabilityMax,
    durability: durabilityMax,
  };
}

/** smelt 재료에서 가장 높은 등급을 결과 롤 티어로 사용 */
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
  applyProficiencyToStats,
  proficiencyLevelFromCount,
  tierFromCatches,
  tierFromMaterials,
};
