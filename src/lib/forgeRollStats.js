'use strict';

/**
 * 숙련도 float → 장비 스탯 배율.
 *   mul = 1.0 + ln(1 + n) × 0.30
 *   n=0  → ×1.000   n=1  → ×1.208   n=3  → ×1.416
 *   n=5  → ×1.537   n=10 → ×1.717   n=20 → ×1.922
 *   n=50 → ×2.193   n=100→ ×2.515
 * @param {number} profFloat
 * @returns {number}
 */
function proficiencyMulFromValue(profFloat) {
  const n = Math.max(0, Number(profFloat) || 0);
  return Number((1.0 + Math.log(1 + n) * 0.30).toFixed(4));
}

/**
 * 대장간 숙련도 정보 반환 (레거시 호환 유지).
 * tier/name/next 필드는 더 이상 사용하지 않습니다.
 * @param {number} totalProficiency — smithingProficiency (float)
 * @returns {{ mul: number }}
 */
function proficiencyLevelFromCount(totalProficiency) {
  return { mul: proficiencyMulFromValue(totalProficiency) };
}

/**
 * 제련 성공 확률 (0.20 ~ 0.93).
 *   숙련도 높을수록 성공률↑ / 재료 강도 높을수록 성공률↓
 *   base = 0.65 + √prof × 0.06
 *   강도보정 = −(avgStr − 2) × 0.05
 *     약함(1): +5%  보통(2): ±0%  강함(3): −5%  최강(4): −10%
 * @param {number} proficiency
 * @param {number} avgMaterialStr — 1.0~4.0
 * @returns {number} 0.20~0.93
 */
function calcSuccessRate(proficiency, avgMaterialStr) {
  const prof = Math.max(0, Number(proficiency) || 0);
  const avg  = Math.max(1, Math.min(4, Number(avgMaterialStr) || 2));
  const base  = 0.65 + Math.sqrt(prof) * 0.06;
  const adj   = -(avg - 2) * 0.05;
  return Math.min(0.93, Math.max(0.20, base + adj));
}

/**
 * 제련 후 숙련도 증가량 (현실적 감소 수익).
 *   성공: 0.005~0.015 기본 / 실패: 0.001~0.005 기본
 *   현재 숙련도가 높을수록 증가폭이 줄어듦: ÷ (1 + √prof × 0.5)
 * @param {number} currentProf
 * @param {boolean} succeeded
 * @returns {number}
 */
function calcProficiencyGain(currentProf, succeeded) {
  const base = succeeded
    ? 0.005 + Math.random() * 0.010   // 성공: 0.005 ~ 0.015
    : 0.001 + Math.random() * 0.004;  // 실패: 0.001 ~ 0.005
  const dimin = 1 + Math.sqrt(Math.max(0, Number(currentProf) || 0)) * 0.5;
  return base / dimin;
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
 * 평균 강도 점수 → 한글 등급 레이블 (UI 표시용).
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
 * 사용된 고유 등급 수 → 조합 품질 레이블.
 * 재료를 다양하게 섞을수록 높은 등급.
 * @param {number} uniqueTierCount 1~4
 * @returns {'단조로운 조합'|'보통 조합'|'좋은 조합'|'최상 조합'}
 */
function harmonyLabel(uniqueTierCount) {
  if (uniqueTierCount >= 4) return '최상 조합';
  if (uniqueTierCount >= 3) return '좋은 조합';
  if (uniqueTierCount >= 2) return '보통 조합';
  return '단조로운 조합';
}

/**
 * 재료 조합의 "장인 배율" — 강도 다양성이 높을수록 강한 장비.
 *
 * 같은 등급만 사용 → 다양성 보너스 없음 (강함만 써도 최강 아님)
 * 약~최강을 골고루 혼합 → 최대 배율
 *
 * 근사 배율 예시:
 *   모두 common  : ~0.40   모두 rare    : ~0.70
 *   모두 epic    : ~1.00   모두 legendary: ~1.30
 *   보통+강함+최강 : ~1.92   약+보통+강함  : ~1.62
 *   약+보통+강함+최강: ~2.22  ← 최고
 *
 * @param {{ tier?: string, rarity?: string }[]} slots
 * @returns {number} 0.10 ~ ~2.22
 */
function craftHarmonyMul(slots) {
  const arr = Array.isArray(slots) ? slots : [];
  if (arr.length === 0) return 0.40;

  const scores = arr.map((s) => strengthFromTier(s.tier || s.rarity || 'common'));
  const n = scores.length;
  const avg = scores.reduce((a, b) => a + b, 0) / n;

  // 1. 평균 품질 기여 (0.40 ~ 1.30): 강한 재료일수록 기본 품질↑
  const avgMul = 0.40 + (avg - 1.0) / 3.0 * 0.90;

  // 2. 다양성 보너스: 고유 등급 수 (1→0 / 2→+0.40 / 3→+0.80 / 4→+1.20)
  const uniqueTierCount = new Set(scores).size;
  const divBonus = (uniqueTierCount - 1) * 0.40;

  // 3. 분산 보너스: 강약 차이가 클수록 추가 (최대 ~0.23)
  const variance = scores.reduce((a, s) => a + (s - avg) ** 2, 0) / n;
  const spreadBonus = Math.sqrt(variance) * 0.15;

  return Math.max(0.10, avgMul + divBonus + spreadBonus);
}

// ─── 시너지 규칙 ──────────────────────────────────────────────
/**
 * 특정 재료 조합에서 발생하는 시너지 보너스.
 * requires 배열의 모든 productId가 재료에 포함되면 발동.
 * bonusMul 은 craftHarmonyMul 에 더해짐 (합산 최대 +1.0).
 *
 * @type {{ id: string, name: string, requires: string[], bonusMul: number }[]}
 */
const SYNERGY_RULES = [
  // ── 금속 합금 ─────────────────────────────────────────────
  { id: 'steel',       name: '강철 합성',    requires: ['iron', 'carbon'],              bonusMul: 0.35 },
  { id: 'stainless',   name: '스테인리스',   requires: ['iron', 'chromium'],            bonusMul: 0.25 },
  { id: 'superalloy',  name: '초경합금',     requires: ['tungsten', 'cobalt'],          bonusMul: 0.40 },
  { id: 'lightweight', name: '경량초강도',   requires: ['titanium', 'graphene'],        bonusMul: 0.45 },
  { id: 'nicromel',    name: '니크롬합금',   requires: ['nickel', 'chromium'],          bonusMul: 0.28 },
  { id: 'bronze',      name: '청동 합성',    requires: ['copper', 'tin'],               bonusMul: 0.18 },
  { id: 'brass',       name: '황동 합성',    requires: ['copper', 'zinc'],              bonusMul: 0.18 },
  { id: 'noble',       name: '귀금속 융합',  requires: ['platinum', 'palladium'],       bonusMul: 0.40 },
  { id: 'mangsteel',   name: '망간강',       requires: ['iron', 'manganese'],           bonusMul: 0.22 },
  // ── 전자/에너지 ───────────────────────────────────────────
  { id: 'electronic',  name: '전자 융합',    requires: ['circuit', 'battery'],          bonusMul: 0.28 },
  { id: 'energy',      name: '에너지 폭발',  requires: ['plasma', 'battery'],           bonusMul: 0.35 },
  { id: 'magneto',     name: '자기전자',     requires: ['neodymium', 'circuit'],        bonusMul: 0.32 },
  { id: 'nanoelec',    name: '나노전자',     requires: ['graphene', 'circuit'],         bonusMul: 0.42 },
  // ── 보석/탄소 ─────────────────────────────────────────────
  { id: 'ultrahard',   name: '초경도 결합',  requires: ['diamond', 'graphene'],         bonusMul: 0.50 },
  { id: 'gemforge',    name: '삼보석 융합',  requires: ['ruby', 'sapphire', 'emerald'], bonusMul: 0.45 },
  { id: 'divtitan',    name: '신성합금',     requires: ['diamond', 'titanium'],         bonusMul: 0.55 },
  { id: 'carboniso',   name: '탄소동소체',   requires: ['carbon', 'graphene'],          bonusMul: 0.30 },
  // ── 화학/특수 ─────────────────────────────────────────────
  { id: 'inferno',     name: '초고온 단조',  requires: ['plasma', 'magma'],             bonusMul: 0.38 },
  { id: 'cryohard',    name: '냉각강화',     requires: ['cryo', 'glass'],               bonusMul: 0.28 },
  { id: 'ballistic',   name: '방탄섬유',     requires: ['kevlar', 'carbonfiber'],       bonusMul: 0.38 },
  { id: 'thermoshock', name: '냉온충격',     requires: ['plasma', 'cryo'],              bonusMul: 0.45 },
  { id: 'volcanic',    name: '화산냉각',     requires: ['magma', 'cryo'],               bonusMul: 0.35 },
  { id: 'quench',      name: '담금질',       requires: ['iron', 'cryo'],                bonusMul: 0.25 },
  { id: 'bio',         name: '생체활성',     requires: ['protein', 'enzyme'],           bonusMul: 0.22 },
];

/**
 * 재료 슬롯에서 발동되는 시너지 목록 반환.
 * @param {{ id: string }[]} slots
 * @returns {{ id: string, name: string, requires: string[], bonusMul: number }[]}
 */
function detectSynergies(slots) {
  const arr = Array.isArray(slots) ? slots : [];
  const productIds = new Set(arr.map((s) => String(s.id || '').toLowerCase()));
  return SYNERGY_RULES.filter((rule) =>
    rule.requires.every((r) => productIds.has(r)),
  );
}

/**
 * 재료 슬롯 + 숙련도 배율로 랜덤 능력치 산출.
 *
 * ● 이미지는 이름+티어로 캐시 — 결정론적 (변경 없음)
 * ● 능력치는 매번 다름: 재료 강도(약함~최강) × 숙련도 × 운(Math.random)
 * ● 시너지 발동 시 craftHarmonyMul 에 bonusMul 합산 (최대 +1.0)
 *
 * 종합 배율 = (장인배율 + 시너지보너스) × 숙련도배율 (최소 0.1)
 *
 * @param {string} _tier — 현재 미사용 (이미지 캐시에서만 쓰임), 호환성 유지
 * @param {{ kind: string, id: string, size?: number|null, tier?: string, rarity?: string }[]} materialSlots
 * @param {number} [proficiencyMul=1.0] — 숙련도 배율 (proficiencyLevelFromCount().mul)
 */
function rollEquipmentStats(_tier, materialSlots, proficiencyMul) {
  const slots = Array.isArray(materialSlots) ? materialSlots : [];

  // ── 장인 배율: 다양성 + 균형으로 계산 ────────────────────
  const craftMul = craftHarmonyMul(slots);

  // ── 시너지 보너스 (최대 +1.0) ─────────────────────────────
  const activeSynergies = detectSynergies(slots);
  const synergyBonus = Math.min(
    1.0,
    activeSynergies.reduce((sum, r) => sum + r.bonusMul, 0),
  );
  const strengthMul = craftMul + synergyBonus;

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
  proficiencyMulFromValue,
  calcSuccessRate,
  calcProficiencyGain,
  tierFromCatches,
  tierFromMaterials,
  strengthFromTier,
  avgMaterialStrength,
  strengthGradeLabel,
  harmonyLabel,
  craftHarmonyMul,
  SYNERGY_RULES,
  detectSynergies,
};
