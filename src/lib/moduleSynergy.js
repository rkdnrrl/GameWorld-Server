'use strict';

const BONUS_SYNERGIES = {
  '화염': { name: '화염 공명',  atkMul: 1.20, defMul: 0.90 },
  '냉기': { name: '빙결 공명',  spdAdd: 0.15, atkMul: 0.95 },
  '번개': { name: '번개 공명',  atkMul: 1.25, durDecayMul: 2.0 },
  '독':   { name: '독성 공명',  defMul: 1.10, spdAdd: -0.10 },
  '신성': { name: '신성 공명',  hpMul: 1.30,  spdAdd: -0.05 },
  '암흑': { name: '암흑 공명',  atkMul: 1.15, hpMul: 0.90 },
  '관통': { name: '관통 공명',  atkMul: 1.30, defMul: 0.80 },
  '방어': { name: '방어 공명',  defMul: 1.25, atkMul: 0.90 },
  '기민': { name: '기민 공명',  spdAdd: 0.20, atkMul: 0.90 },
  '강화': { name: '강화 공명',  atkMul: 1.15, defMul: 1.10 },
  '치유': { name: '치유 공명',  hpMul: 1.40,  atkMul: 0.85 },
  '저주': { name: '저주 공명',  atkMul: 1.15, defMul: 1.15, spdAdd: 0.05, hpMul: 1.10, durDecayMul: 1.5 },
};

const CONFLICT_PAIRS = [
  { pair: ['화염', '냉기'], name: '증기 폭발',   effect: { atkMul: 0.80, defMul: 0.80 } },
  { pair: ['신성', '암흑'], name: '존재 부정',   effect: { atkMul: 0.70, defMul: 0.70, spdAdd: -0.10, hpMul: 0.70 } },
  { pair: ['관통', '방어'], name: '모순 구조',   effect: { atkMul: 0.85, defMul: 0.85 } },
  { pair: ['기민', '강화'], name: '무게 과부하', effect: { spdAdd: -0.10, atkMul: 0.90 } },
  { pair: ['독',   '치유'], name: '약효 상쇄',   effect: { defMul: 0.90, hpMul: 0.85 } },
  { pair: ['번개', '냉기'], name: '전도 방해',   effect: { atkMul: 0.85, spdAdd: -0.10 } },
];

/**
 * Calculate synergy effects from an array of module objects.
 * Each module must have a `keywords` array.
 *
 * @param {Array<{keywords: string[]}>} modules
 * @returns {{ bonuses: {name:string,desc:string}[], penalties: {name:string,desc:string}[], muls: {atkMul,defMul,spdAdd,hpMul,durDecayMul} }}
 */
function calcSynergy(modules) {
  // Count keyword occurrences across all modules
  const keywordCounts = {};
  for (const mod of modules) {
    for (const kw of (mod.keywords || [])) {
      keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
    }
  }

  const presentKeywords = new Set(Object.keys(keywordCounts).filter(k => keywordCounts[k] >= 1));

  // Accumulate multipliers — start from identity values
  let atkMul = 1.0;
  let defMul = 1.0;
  let spdAdd = 0.0;
  let hpMul  = 1.0;
  let durDecayMul = 1.0;

  const penalties = [];
  const bonuses   = [];

  // Conflicts apply first
  for (const cp of CONFLICT_PAIRS) {
    const [a, b] = cp.pair;
    if (presentKeywords.has(a) && presentKeywords.has(b)) {
      const ef = cp.effect;
      if (ef.atkMul != null)      atkMul      *= ef.atkMul;
      if (ef.defMul != null)      defMul      *= ef.defMul;
      if (ef.spdAdd != null)      spdAdd      += ef.spdAdd;
      if (ef.hpMul  != null)      hpMul       *= ef.hpMul;
      if (ef.durDecayMul != null) durDecayMul *= ef.durDecayMul;
      penalties.push({ name: cp.name, desc: _describeEffect(ef) });
    }
  }

  // Bonus synergies (keyword must appear 2+ times)
  for (const [kw, syn] of Object.entries(BONUS_SYNERGIES)) {
    if ((keywordCounts[kw] || 0) >= 2) {
      if (syn.atkMul      != null) atkMul      *= syn.atkMul;
      if (syn.defMul      != null) defMul      *= syn.defMul;
      if (syn.spdAdd      != null) spdAdd      += syn.spdAdd;
      if (syn.hpMul       != null) hpMul       *= syn.hpMul;
      if (syn.durDecayMul != null) durDecayMul *= syn.durDecayMul;
      bonuses.push({ name: syn.name, desc: _describeEffect(syn) });
    }
  }

  return {
    bonuses,
    penalties,
    muls: { atkMul, defMul, spdAdd, hpMul, durDecayMul },
  };
}

function _describeEffect(ef) {
  const parts = [];
  if (ef.atkMul  != null && ef.atkMul  !== 1) parts.push(`공격×${ef.atkMul}`);
  if (ef.defMul  != null && ef.defMul  !== 1) parts.push(`방어×${ef.defMul}`);
  if (ef.spdAdd  != null && ef.spdAdd  !== 0) parts.push(`속도${ef.spdAdd > 0 ? '+' : ''}${ef.spdAdd}`);
  if (ef.hpMul   != null && ef.hpMul   !== 1) parts.push(`HP×${ef.hpMul}`);
  if (ef.durDecayMul != null && ef.durDecayMul !== 1) parts.push(`내구소모×${ef.durDecayMul}`);
  return parts.join(', ');
}

module.exports = { calcSynergy, BONUS_SYNERGIES, CONFLICT_PAIRS };
