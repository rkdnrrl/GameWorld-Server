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

// ─── 재료 강도 ────────────────────────────────────────────────

/**
 * smelt 산출물의 rarity/tier 문자열 → 강도 점수 (1=약함, 2=보통, 3=강함, 4=최강)
 * @param {string} tier
 * @returns {1|2|3|4}
 */
function strengthFromTier(tier) {
  const t = String(tier || 'common').toLowerCase();
  if (t === 'legendary') return 4;
  if (t === 'epic') return 3;
  if (t === 'rare') return 2;
  return 1; // common
}

/**
 * 재료 슬롯 배열의 평균 강도 점수 (1.0 ~ 4.0).
 * @param {{ tier?: string, rarity?: string }[]} slots
 * @returns {number}
 */
function avgMaterialStrength(slots) {
  const arr = Array.isArray(slots) ? slots : [];
  if (arr.length === 0) return 1;
  let total = 0;
  for (const s of arr) {
    total += strengthFromTier(s.tier || s.rarity || 'common');
  }
  return total / arr.length;
}

/**
 * 평균 강도 점수 → 한글 등급 레이블.
 * - 약함: 1.0~1.49  (common 위주)
 * - 보통: 1.5~2.49  (rare 위주)
 * - 강함: 2.5~3.49  (epic 위주)
 * - 최강: 3.5~4.0   (legendary 위주)
 * @param {number} avgStr
 * @returns {'약함'|'보통'|'강함'|'최강'}
 */
function strengthGradeLabel(avgStr) {
  if (avgStr >= 3.5) return '최강';
  if (avgStr >= 2.5) return '강함';
  if (avgStr >= 1.5) return '보통';
  return '약함';
}

/**
 * 재료 슬롯 + 숙련도 배율로 랜덤 능력치 산출.
 *
 * ● 이미지는 이름+티어로 캐시 — 결정론적 (변경 없음)
 * ● 능력치는 매번 다름: 재료 강도(약함~최강) × 숙련도 × 운(Math.random)
 *
 * 강도 배율 매핑:
 *   약함(avg 1) → ×0.50   보통(avg 2) → ×1.17
 *   강함(avg 3) → ×1.83   최강(avg 4) → ×2.50
 *
 * 종합 배율 = 강도배율 × 숙련도배율 (최소 0.1, 최대 약 5.0)
 *
 * @param {string} _tier — 현재 미사용 (이미지 캐시에서만 쓰임), 호환성 유지
 * @param {{ kind: string, id: string, size?: number|null, tier?: string, rarity?: string }[]} materialSlots
 * @param {number} [proficiencyMul=1.0] — 숙련도 배율 (proficiencyLevelFromCount().mul)
 */
function rollEquipmentStats(_tier, materialSlots, proficiencyMul) {
  const slots = Array.isArray(materialSlots) ? materialSlots : [];

  // ── 재료 강도 배율 ─────────────────────────────────────────
  // 약함(1)→0.50 / 보통(2)→1.17 / 강함(3)→1.83 / 최강(4)→2.50
  const avgStr = avgMaterialStrength(slots);
  const strengthMul = 0.5 + (avgStr - 1.0) / 3.0 * 2.0;

  // ── 숙련도 배율 ───────────────────────────────────────────
  const profMul = (typeof proficiencyMul === 'number' && Number.isFinite(proficiencyMul) && proficiencyMul > 0)
    ? proficiencyMul : 1.0;

  // ── 종합 배율 ─────────────────────────────────────────────
  const effectiveMul = Math.max(0.1, strengthMul * profMul);

  // ── 운(랜덤) — 같은 재료라도 매번 다른 수치 ──────────────
  const r = () => Math.random();

  const base = 3 + Math.floor(r() * 12 * effectiveMul);
  const durabilityMax = Math.min(999, Math.max(28, Math.round(30 + r() * 60 * effectiveMul)));

  return {
    attackBonus:  Math.max(1, Math.round(base + r() * 8 * effectiveMul)),
    defenseBonus: Math.max(0, Math.round(base * 0.6 + r() * 7 * effectiveMul)),
    speedBonus:   Math.min(0.5, Number((0.015 + r() * 0.05 * effectiveMul).toFixed(3))),
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
  strengthFromTier,
  avgMaterialStrength,
  strengthGradeLabel,
};
