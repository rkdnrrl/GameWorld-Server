'use strict';

const adjectives = require('../data/adjectives.json');
const nouns = require('../data/baseNouns.json');

// 산출물 ID → 낚시 확률 가중치 (낮을수록 잡기 힘듦)
const PRODUCT_CATCH_WEIGHT = {
  // 매우 흔함 (80)
  iron: 80, rubber: 80, plastic: 80, textile: 80, resin: 80, glass: 80,
  ceramic: 80, leather: 80, sand: 80, carbon: 80, graphite: 80, fiber: 80,
  salt: 80, sulfur: 80, petro: 80, protein: 80, chitin: 80, keratin: 80,
  enzyme: 80, concrete: 80, cement: 80, asphalt: 80, bitumen: 80,
  limestone: 80, granite: 80, basalt: 80, sodaash: 80, phosphor: 80,
  phosphate: 80, chloride: 80, nitrate: 80, ammonia: 80,
  hydrogen: 80, oxygen: 80, nitrogen: 80, helium: 80, argon: 80, biofuel: 80,

  // 흔함 (30)
  copper: 30, aluminum: 30, nickel: 30, zinc: 30, tin: 30, lead: 30,
  manganese: 30, chromium: 30, silver: 30, battery: 30, circuit: 30,
  silicon: 30, silica: 30, wafer: 30, carbonfiber: 30, kevlar: 30,

  // 희귀 (10)
  gold: 10, titanium: 10, cobalt: 10, lithium: 10, magnesium: 10,
  lithiumsalt: 10, graphene: 10, vanadium: 10, niobium: 10,
  bismuth: 10, antimony: 10, plasma: 10, magma: 10, cryo: 10,

  // 에픽 (3)
  platinum: 3, tungsten: 3, molybdenum: 3, rareearth: 3,
  neodymium: 3, lanthanum: 3, cerium: 3, samarium: 3, yttrium: 3,
  gallium: 3, germanium: 3, indium: 3, selenium: 3, tellurium: 3,
  hafnium: 3, tantalum: 3, zirconium: 3,
  pearl: 3, opal: 3, topaz: 3, garnet: 3, amethyst: 3,
  emerald: 3, sapphire: 3, ruby: 3,

  // 전설 (1)
  palladium: 1, rhodium: 1, iridium: 1, uranium: 1, diamond: 1,
};

// 명사의 가중치 = 가장 희귀한 산출물 기준
function getNounWeight(noun) {
  const weights = noun.smeltProducts.map((pid) => PRODUCT_CATCH_WEIGHT[pid] ?? 30);
  return Math.min(...weights);
}

// 가중치 합산 (최초 1회 계산)
const _nounEntries = nouns.map((n) => ({ noun: n, weight: getNounWeight(n) }));
const _totalWeight = _nounEntries.reduce((s, e) => s + e.weight, 0);

function weightedPickNoun() {
  let r = Math.random() * _totalWeight;
  for (const e of _nounEntries) {
    r -= e.weight;
    if (r <= 0) return e.noun;
  }
  return _nounEntries[_nounEntries.length - 1].noun;
}

function pickAdj(tier) {
  const pool = adjectives[tier] || adjectives.common;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * @param {'common'|'rare'|'epic'|'legendary'} tier
 * @returns {{ name: string, emoji: string, tier: string, smeltProducts: string[], visualEn: string }}
 */
function pickFishingItem(tier) {
  const adj = pickAdj(tier);
  const noun = weightedPickNoun();
  return {
    name: `${adj} ${noun.name}`,
    emoji: noun.emoji,
    tier,
    smeltProducts: noun.smeltProducts,
    visualEn: noun.visualEn,
  };
}

module.exports = { pickFishingItem };
