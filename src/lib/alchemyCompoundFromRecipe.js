'use strict';

/**
 * 주기율표 원소 조합 → **항상 동일한** 게임 산출물 (이름·희귀도·문구·PixelLab 힌트).
 * 같은 기호·수량 집합이면 슬롯 순서·표시 이름이 달라도 결과가 같다.
 */

const crypto = require('crypto');
const { normalizeElementSymbol, isValidElementSymbol } = require('./periodicElementSymbols');

const ADJECTIVES = [
  '잿빛',
  '금빛',
  '푸른',
  '붉은',
  '창백한',
  '짙은',
  '은은한',
  '낡은',
  '맑은',
  '탁한',
  '차가운',
  '따뜻한',
  '거친',
  '고운',
  '검은',
  '하얀',
];

const NOUNS = [
  '합금',
  '결정',
  '가루',
  '덩어리',
  '액체',
  '괴',
  '껍질',
  '잔재',
  '혼합체',
  '응집체',
  '결정체',
  '알갱이',
  '덩이',
  '광맥',
  '잔류물',
  '광석',
];

const EMOJI_POOL = ['⚗', '🧪', '💎', '🔮', '✨', '🧬', '🔬', '🫧', '💠', '🔷', '🟣', '🟤'];

/** @param {{ symbol: string, qty: number, name?: string }[]} slots */
function mergeSlotsBySymbol(slots) {
  const m = new Map();
  for (const s of slots || []) {
    const sym = normalizeElementSymbol(s && s.symbol);
    if (!sym || !isValidElementSymbol(sym)) continue;
    const qty = Math.max(1, Math.floor(Number(s && s.qty)) || 1);
    const name =
      typeof s.name === 'string' && s.name.trim()
        ? s.name.trim().replace(/\s+/g, ' ').slice(0, 120)
        : '';
    const cur = m.get(sym);
    if (!cur) {
      m.set(sym, { symbol: sym, qty, name: name || sym });
    } else {
      m.set(sym, {
        symbol: sym,
        qty: cur.qty + qty,
        name: cur.name || name,
      });
    }
  }
  return Array.from(m.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** @param {{ symbol: string, qty: number }[]} merged */
function recipeFingerprintLine(merged) {
  return merged.map((s) => `${s.symbol}:${s.qty}`).join('+');
}

/**
 * @param {{ symbol: string, qty: number, name?: string }[]} slots
 * @returns {string} 20 hex — shared_pixel_arts 키 조각과 동일 규칙
 */
function alchemyRecipeFingerprint(slots) {
  const merged = mergeSlotsBySymbol(slots);
  const line = recipeFingerprintLine(merged);
  return crypto.createHash('sha256').update(line, 'utf8').digest('hex').slice(0, 20);
}

function hashU32(line, salt) {
  return crypto.createHash('sha256').update(`${line}\0${salt}`, 'utf8').digest().readUInt32BE(0);
}

const VISUAL_HINTS = [
  'small corked glass bottle with colored liquid centered chunky pixels',
  'single crystal shard cluster centered chunky pixels',
  'heap of metallic powder centered chunky pixels',
  'round glass vial with cork stopper centered chunky pixels',
  'glowing mineral orb centered chunky pixels',
  'sealed wax pouch bundle centered chunky pixels',
  'alchemy flask with narrow neck centered chunky pixels',
  'two fused metal ingots small centered chunky pixels',
  'cracked geode half with shiny core centered chunky pixels',
  'tiny mortar with dust pile centered chunky pixels',
  'amber resin blob centered chunky pixels',
  'blue-white salt crystals pile centered chunky pixels',
  'iron-gray nugget centered chunky pixels',
  'copper-green patina chunk centered chunky pixels',
  'purple gem chip centered chunky pixels',
  'golden dust swirl centered chunky pixels',
  'opaque ceramic jar centered chunky pixels',
  'double bubble glass ampoule centered chunky pixels',
  'spiral galaxy dust in a jar centered chunky pixels',
  'molten slag droplet cooled centered chunky pixels',
  'stacked flat tablets centered chunky pixels',
  'rough meteorite chip centered chunky pixels',
  'teal liquid in round-bottom flask centered chunky pixels',
  'silver wire coil ball centered chunky pixels',
  'red powder mound centered chunky pixels',
  'green glass marble sized orb centered chunky pixels',
  'black sand cone centered chunky pixels',
  'white chalky brick chip centered chunky pixels',
  'bronze gear fused blob centered chunky pixels',
  'iridescent oil slick bead centered chunky pixels',
  'smoky quartz point centered chunky pixels',
  'fossilized shell fragment centered chunky pixels',
];

/**
 * @param {{ symbol: string, qty: number, name?: string }[]} slots
 * @returns {{ compoundNameKo: string, itemEmoji: string, rarity: string, rationaleKo: string, formulaStyleKo: string, visualHintEn: string }}
 */
function compoundFromRecipeSlots(slots) {
  const merged = mergeSlotsBySymbol(slots);
  if (merged.length < 1) {
    return { reason: 'empty_recipe' };
  }

  const line = recipeFingerprintLine(merged);
  const hName = hashU32(line, 'name');
  const hRare = hashU32(line, 'rarity');
  const hEmoji = hashU32(line, 'emoji');
  const hHint = hashU32(line, 'visual');

  const formulaAscii = merged
    .map((s) => (s.qty === 1 ? s.symbol : `${s.symbol}${s.qty}`))
    .join('+');

  const adj = ADJECTIVES[hName % ADJECTIVES.length];
  const noun = NOUNS[(hName >>> 8) % NOUNS.length];
  let compoundNameKo = `${adj} ${noun}「${formulaAscii}」`.replace(/\s+/g, ' ').trim();
  if (compoundNameKo.length > 50) {
    compoundNameKo = `${adj}${noun}「${formulaAscii}」`.slice(0, 50);
  }

  const rarityRoll = hRare % 100;
  const rarity = rarityRoll < 68 ? 'common' : rarityRoll < 94 ? 'epic' : 'legendary';

  const itemEmoji = EMOJI_POOL[hEmoji % EMOJI_POOL.length];

  const labels = merged.map((s) => (s.name && s.name !== s.symbol ? `${s.name}(${s.symbol})` : s.symbol));
  const listKo = labels.join(', ');
  let rationaleKo = `${listKo}의 비율이 맞물려 「${formulaAscii}」 조합의 산출물이 되었습니다.`;
  if (rationaleKo.length > 220) {
    rationaleKo = `${listKo.slice(0, 120)}… 등이 합쳐져 안정된 산출물이 되었습니다.`.slice(0, 220);
  }

  const formulaStyleKo = merged.map((s) => (s.qty === 1 ? s.symbol : `${s.symbol}×${s.qty}`)).join(' + ');

  const visualHintEn = VISUAL_HINTS[hHint % VISUAL_HINTS.length];

  return {
    compoundNameKo,
    itemEmoji,
    rarity,
    rationaleKo,
    formulaStyleKo,
    visualHintEn,
  };
}

module.exports = {
  mergeSlotsBySymbol,
  recipeFingerprintLine,
  alchemyRecipeFingerprint,
  compoundFromRecipeSlots,
};
