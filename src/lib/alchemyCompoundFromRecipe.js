'use strict';

/**
 * 주기율표 원소 조합 → **항상 동일한** 게임 산출물 (이름·문구·PixelLab 힌트). 희귀도는 없음(항상 일반).
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

/**
 * @param {{ symbol: string, qty: number, name?: string }[]} slots
 * @returns {{ compoundNameKo: string, itemEmoji: string, rarity: 'common', rationaleKo: string, formulaStyleKo: string }}
 */
function compoundFromRecipeSlots(slots) {
  const merged = mergeSlotsBySymbol(slots);
  if (merged.length < 1) {
    return { reason: 'empty_recipe' };
  }

  const line = recipeFingerprintLine(merged);

  /** 알려진 조합 → 고정 표기 (같은 식이면 항상 동일) */
  const CANONICAL_BY_LINE = {
    'H:2+O:1': {
      compoundNameKo: '물「H2O」',
      formulaStyleKo: 'H₂O',
      itemEmoji: '💧',
    },
  };
  const canonical = CANONICAL_BY_LINE[line];

  const hName = hashU32(line, 'name');
  const hEmoji = hashU32(line, 'emoji');

  const formulaAscii = merged
    .map((s) => (s.qty === 1 ? s.symbol : `${s.symbol}${s.qty}`))
    .join('+');

  const labels = merged.map((s) => (s.name && s.name !== s.symbol ? `${s.name}(${s.symbol})` : s.symbol));
  const listKo = labels.join(', ');

  const adj = ADJECTIVES[hName % ADJECTIVES.length];
  const noun = NOUNS[(hName >>> 8) % NOUNS.length];
  let compoundNameKo = `${adj} ${noun}「${formulaAscii}」`.replace(/\s+/g, ' ').trim();
  if (compoundNameKo.length > 50) {
    compoundNameKo = `${adj}${noun}「${formulaAscii}」`.slice(0, 50);
  }

  const rarity = 'common';

  let itemEmoji = EMOJI_POOL[hEmoji % EMOJI_POOL.length];

  let rationaleKo = `${listKo}의 비율이 맞물려 「${formulaAscii}」 조합의 산출물이 되었습니다.`;
  if (rationaleKo.length > 220) {
    rationaleKo = `${listKo.slice(0, 120)}… 등이 합쳐져 안정된 산출물이 되었습니다.`.slice(0, 220);
  }

  let formulaStyleKo = merged.map((s) => (s.qty === 1 ? s.symbol : `${s.symbol}×${s.qty}`)).join(' + ');

  if (canonical) {
    if (canonical.compoundNameKo) compoundNameKo = String(canonical.compoundNameKo).slice(0, 50);
    if (canonical.formulaStyleKo) formulaStyleKo = canonical.formulaStyleKo;
    if (canonical.itemEmoji) itemEmoji = canonical.itemEmoji.slice(0, 10);
    if (line === 'H:2+O:1') {
      rationaleKo = `${listKo}가 맞는 비율로 합쳐져 물(H₂O)이 되었습니다.`.slice(0, 220);
    }
  }

  return {
    compoundNameKo,
    itemEmoji,
    rarity,
    rationaleKo,
    formulaStyleKo,
  };
}

module.exports = {
  mergeSlotsBySymbol,
  recipeFingerprintLine,
  alchemyRecipeFingerprint,
  compoundFromRecipeSlots,
};
