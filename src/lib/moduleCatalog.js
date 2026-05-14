'use strict';

const TIER_MUL = { common: 1.0, rare: 1.6, epic: 2.8, legendary: 5.0 };
const TIER_DUR = { common: 25, rare: 40, epic: 60, legendary: 100 };

// Module slot definitions per equipment type
const EQUIP_MODULE_SLOTS = {
  weapon:    ['barrel', 'scope', 'grip', 'muzzle', 'buffer'],
  head:      ['padding', 'visor', 'buffer'],
  chest:     ['padding', 'reinforcement', 'lining', 'buffer'],
  pants:     ['padding', 'buffer'],
  gloves:    ['grip', 'padding', 'buffer'],
  boots:     ['sole', 'padding', 'buffer'],
  accessory: ['gem', 'enchant', 'buffer'],
};

// Offensive modules (durability decreases on player attack)
const OFFENSIVE_TYPES = new Set(['barrel', 'scope', 'grip', 'muzzle', 'gem']);
// Defensive modules (durability decreases on player damage taken)
const DEFENSIVE_TYPES = new Set(['padding', 'reinforcement', 'visor', 'lining', 'sole', 'enchant']);
// Buffer modules (durability decreases instead of the parent equipment)
const BUFFER_TYPES = new Set(['buffer']);

const MODULE_CATALOG = {
  barrel: {
    label: '날/총열', emoji: '⚔️', equipSlots: ['weapon'],
    variants: [
      { name: '화염의 날', keywords: ['화염'], stats: { attackBonus: 3 } },
      { name: '냉기의 날', keywords: ['냉기'], stats: { attackBonus: 2, defenseBonus: 1 } },
      { name: '번개의 날', keywords: ['번개'], stats: { attackBonus: 4 } },
      { name: '독의 날',   keywords: ['독'],   stats: { attackBonus: 2, defenseBonus: -1 } },
      { name: '관통의 날', keywords: ['관통'], stats: { attackBonus: 3 } },
      { name: '암흑의 날', keywords: ['암흑'], stats: { attackBonus: 3, hpBonus: -5 } },
      { name: '신성한 날', keywords: ['신성'], stats: { attackBonus: 2, hpBonus: 5 } },
    ],
  },
  scope: {
    label: '조준기', emoji: '🎯', equipSlots: ['weapon'],
    variants: [
      { name: '화염 조준기', keywords: ['화염'], stats: { attackBonus: 2 } },
      { name: '신성 조준기', keywords: ['신성'], stats: { attackBonus: 1, hpBonus: 8 } },
      { name: '관통 조준기', keywords: ['관통'], stats: { attackBonus: 2 } },
      { name: '기민 조준기', keywords: ['기민'], stats: { attackBonus: 1, speedBonus: 0.05 } },
      { name: '강화 조준기', keywords: ['강화'], stats: { attackBonus: 2, defenseBonus: 1 } },
    ],
  },
  grip: {
    label: '손잡이', emoji: '✊', equipSlots: ['weapon', 'gloves'],
    variants: [
      { name: '강화 손잡이', keywords: ['강화'], stats: { attackBonus: 1, defenseBonus: 1 } },
      { name: '기민 손잡이', keywords: ['기민'], stats: { speedBonus: 0.08 } },
      { name: '저주 손잡이', keywords: ['저주'], stats: { attackBonus: 1, defenseBonus: 1, speedBonus: 0.03 } },
      { name: '번개 손잡이', keywords: ['번개'], stats: { attackBonus: 2, speedBonus: 0.05 } },
    ],
  },
  muzzle: {
    label: '날끝/총구', emoji: '💥', equipSlots: ['weapon'],
    variants: [
      { name: '화염 날끝', keywords: ['화염'], stats: { attackBonus: 2 } },
      { name: '번개 날끝', keywords: ['번개'], stats: { attackBonus: 3 } },
      { name: '독 날끝',   keywords: ['독'],   stats: { attackBonus: 1, defenseBonus: 1 } },
      { name: '냉기 날끝', keywords: ['냉기'], stats: { attackBonus: 1, speedBonus: 0.05 } },
      { name: '관통 날끝', keywords: ['관통'], stats: { attackBonus: 2 } },
      { name: '암흑 날끝', keywords: ['암흑'], stats: { attackBonus: 2, hpBonus: -3 } },
    ],
  },
  padding: {
    label: '내장재', emoji: '🛡️', equipSlots: ['head', 'chest', 'pants', 'gloves', 'boots'],
    variants: [
      { name: '방어 내장재', keywords: ['방어'], stats: { defenseBonus: 3 } },
      { name: '신성 내장재', keywords: ['신성'], stats: { defenseBonus: 2, hpBonus: 5 } },
      { name: '치유 내장재', keywords: ['치유'], stats: { defenseBonus: 1, hpBonus: 8 } },
      { name: '기민 내장재', keywords: ['기민'], stats: { defenseBonus: 1, speedBonus: 0.03 } },
      { name: '강화 내장재', keywords: ['강화'], stats: { defenseBonus: 2, attackBonus: 1 } },
    ],
  },
  reinforcement: {
    label: '보강재', emoji: '⚙️', equipSlots: ['chest'],
    variants: [
      { name: '방어 보강재', keywords: ['방어'], stats: { defenseBonus: 4 } },
      { name: '강화 보강재', keywords: ['강화'], stats: { defenseBonus: 3, attackBonus: 1 } },
      { name: '독 보강재',   keywords: ['독'],   stats: { defenseBonus: 3, hpBonus: -5 } },
      { name: '치유 보강재', keywords: ['치유'], stats: { defenseBonus: 2, hpBonus: 8 } },
    ],
  },
  visor: {
    label: '바이저', emoji: '👁️', equipSlots: ['head'],
    variants: [
      { name: '기민 바이저', keywords: ['기민'], stats: { speedBonus: 0.05, hpBonus: 3 } },
      { name: '신성 바이저', keywords: ['신성'], stats: { hpBonus: 5, speedBonus: 0.03 } },
      { name: '암흑 바이저', keywords: ['암흑'], stats: { attackBonus: 1, speedBonus: 0.04 } },
    ],
  },
  lining: {
    label: '라이닝', emoji: '🧶', equipSlots: ['chest'],
    variants: [
      { name: '치유 라이닝', keywords: ['치유'], stats: { hpBonus: 10 } },
      { name: '기민 라이닝', keywords: ['기민'], stats: { speedBonus: 0.05, hpBonus: 5 } },
      { name: '신성 라이닝', keywords: ['신성'], stats: { hpBonus: 8, defenseBonus: 1 } },
    ],
  },
  sole: {
    label: '밑창', emoji: '👟', equipSlots: ['boots'],
    variants: [
      { name: '기민 밑창', keywords: ['기민'], stats: { speedBonus: 0.10 } },
      { name: '냉기 밑창', keywords: ['냉기'], stats: { speedBonus: 0.08, defenseBonus: 1 } },
      { name: '번개 밑창', keywords: ['번개'], stats: { speedBonus: 0.06, attackBonus: 1 } },
    ],
  },
  gem: {
    label: '보석', emoji: '💎', equipSlots: ['accessory'],
    variants: [
      { name: '화염석', keywords: ['화염'], stats: { attackBonus: 4 } },
      { name: '냉기석', keywords: ['냉기'], stats: { attackBonus: 2, defenseBonus: 3 } },
      { name: '번개석', keywords: ['번개'], stats: { attackBonus: 5 } },
      { name: '독석',   keywords: ['독'],   stats: { attackBonus: 2, defenseBonus: 2 } },
      { name: '신성석', keywords: ['신성'], stats: { attackBonus: 2, hpBonus: 10 } },
      { name: '암흑석', keywords: ['암흑'], stats: { attackBonus: 4, hpBonus: -5 } },
      { name: '관통석', keywords: ['관통'], stats: { attackBonus: 4, defenseBonus: -1 } },
    ],
  },
  enchant: {
    label: '각인', emoji: '✨', equipSlots: ['accessory'],
    variants: [
      { name: '신성 각인', keywords: ['신성'], stats: { hpBonus: 8, defenseBonus: 1 } },
      { name: '암흑 각인', keywords: ['암흑'], stats: { attackBonus: 2, hpBonus: -3 } },
      { name: '저주 각인', keywords: ['저주'], stats: { attackBonus: 1, defenseBonus: 1, hpBonus: 3 } },
      { name: '치유 각인', keywords: ['치유'], stats: { hpBonus: 12 } },
      { name: '강화 각인', keywords: ['강화'], stats: { attackBonus: 1, defenseBonus: 2 } },
    ],
  },
  buffer: {
    label: '완충재', emoji: '🛡️', equipSlots: ['weapon', 'head', 'chest', 'pants', 'gloves', 'boots', 'accessory'],
    variants: [
      { name: '철제 완충재',   keywords: ['방어'], stats: { defenseBonus: 1 } },
      { name: '강철 완충재',   keywords: ['강화'], stats: { defenseBonus: 1, attackBonus: 1 } },
      { name: '신성 완충재',   keywords: ['신성'], stats: { defenseBonus: 1, hpBonus: 5 } },
      { name: '암흑 완충재',   keywords: ['암흑'], stats: { defenseBonus: 2, hpBonus: -3 } },
      { name: '치유 완충재',   keywords: ['치유'], stats: { defenseBonus: 1, hpBonus: 8 } },
      { name: '기민 완충재',   keywords: ['기민'], stats: { defenseBonus: 1, speedBonus: 0.03 } },
      { name: '마법 완충재',   keywords: ['강화', '치유'], stats: { defenseBonus: 2, hpBonus: 5 } },
    ],
  },
};

/**
 * Apply tier multiplier to base stats.
 * Integer stats are rounded; speedBonus is rounded to 3 decimal places.
 */
function applyTierToStats(baseStats, tier) {
  const mul = TIER_MUL[tier] || 1.0;
  const result = {};
  for (const [key, val] of Object.entries(baseStats)) {
    if (key === 'speedBonus') {
      result[key] = Math.round(val * mul * 1000) / 1000;
    } else {
      result[key] = Math.round(val * mul);
    }
  }
  return result;
}

/**
 * Determine tier from total smelt material count.
 */
function tierFromMaterialCount(count) {
  if (count >= 5) return 'legendary';
  if (count >= 3) return 'epic';
  if (count >= 2) return 'rare';
  return 'common';
}

module.exports = {
  MODULE_CATALOG,
  EQUIP_MODULE_SLOTS,
  OFFENSIVE_TYPES,
  DEFENSIVE_TYPES,
  BUFFER_TYPES,
  TIER_MUL,
  TIER_DUR,
  applyTierToStats,
  tierFromMaterialCount,
};
