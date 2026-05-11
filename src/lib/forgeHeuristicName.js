'use strict';

const MAX_EQUIP_NAME = 30;

/** 표기용 한글만 (합성 이름용) */
function hangulOnly(s) {
  return String(s || '').replace(/[^가-힣]/g, '');
}

const BLEND_SUFFIX = ['날', '심', '릭', '드', '텍', '온', '프', '즈', '빛', '심'];

function pickSuffix(seed) {
  const n = String(seed || '').length;
  return BLEND_SUFFIX[Math.abs(n * 17) % BLEND_SUFFIX.length];
}

/**
 * 재료 풀에서 짧은 합성 이름 (예: 유리 + …버드 → 유리버드). 원문 풀네임 나열 금지.
 * @param {{ kind: string, itemName?: string, name?: string }[]} resolved
 */
function heuristicEquipmentNameFromResolved(resolved) {
  const names = (resolved || [])
    .map((m) => (m.kind === 'catch' ? m.itemName : m.name))
    .map((n) => String(n != null ? n : '').trim())
    .filter((x) => x.length > 0);
  if (names.length === 0) return '무명합금';

  const hang = names.map((nm) => hangulOnly(nm)).filter((h) => h.length > 0);
  if (hang.length === 0) return '무명합금';

  if (hang.length === 1) {
    const h = hang[0];
    const core = h.length <= 4 ? h : `${h.slice(0, 2)}${h.slice(-2)}`;
    return `${core}${pickSuffix(h)}`.slice(0, MAX_EQUIP_NAME);
  }

  if (hang.length === 2) {
    const a = hang[0];
    const b = hang[1];
    const head = a.slice(0, 2) || a.slice(0, 1) || '무';
    const tail = b.length >= 2 ? b.slice(-2) : b.slice(0, Math.min(2, b.length)) || '명';
    return `${head}${tail}`.slice(0, MAX_EQUIP_NAME);
  }

  if (hang.length === 3) {
    const c0 = hang[0].slice(0, 1) || '·';
    const c1 = hang[1].slice(0, 1) || '·';
    const c2 = hang[2].slice(-1) || hang[2].slice(0, 1) || '·';
    const suf = pickSuffix(hang.join(''));
    return `${c0}${c1}${c2}${suf}`.slice(0, MAX_EQUIP_NAME);
  }

  const bits = hang
    .slice(0, 4)
    .map((h) => h.slice(0, 1))
    .join('');
  const suf = pickSuffix(bits + String(hang.length));
  return `${bits}${suf}`.slice(0, MAX_EQUIP_NAME);
}

module.exports = { heuristicEquipmentNameFromResolved, hangulOnly };
