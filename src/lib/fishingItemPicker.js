'use strict';

const adjectives = require('../data/adjectives.json');
const nouns = require('../data/baseNouns.json');

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * @param {'common'|'rare'|'epic'|'legendary'} tier
 * @returns {{ name: string, emoji: string, tier: string, smeltProducts: string[], visualEn: string }}
 */
function pickFishingItem(tier) {
  const adjPool = adjectives[tier] || adjectives.common;
  const adj = pick(adjPool);
  const noun = pick(nouns);
  return {
    name: `${adj} ${noun.name}`,
    emoji: noun.emoji,
    tier,
    smeltProducts: noun.smeltProducts,
    visualEn: noun.visualEn,
  };
}

module.exports = { pickFishingItem };
