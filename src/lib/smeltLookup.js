'use strict';

const nouns = require('../data/baseNouns.json');

// 길이 내림차순 정렬 — 긴 명사를 먼저 검사해 짧은 명사에 의한 오매칭 방지
const _entries = nouns
  .filter((n) => Array.isArray(n.smeltProducts) && n.smeltProducts.length > 0)
  .sort((a, b) => b.name.length - a.name.length)
  .map((n) => [n.name, n.smeltProducts, n.tier || 'common']);

/**
 * itemName 안에서 알려진 명사를 찾아 smeltProducts와 noun tier 반환.
 * 없으면 null (키워드 기반 폴백 사용).
 * @param {string} itemName
 * @returns {{ products: string[], tier: string } | null}
 */
function smeltProductsFromNoun(itemName) {
  const name = String(itemName || '');
  for (const [noun, products, tier] of _entries) {
    if (name.includes(noun)) return { products, tier };
  }
  return null;
}

module.exports = { smeltProductsFromNoun };
