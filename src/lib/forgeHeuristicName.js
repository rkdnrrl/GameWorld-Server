'use strict';

const MAX_EQUIP_NAME = 30;

function endsWithBatchimKo(str) {
  const s = String(str);
  if (!s) return false;
  const c = s.charCodeAt(s.length - 1);
  if (Number.isNaN(c) || c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

function clampPart(s, maxChars) {
  const t = String(s != null ? s : '').trim();
  if (!t) return '재료';
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * Singleplay-Game5 `mergeEquipmentName` 과 동일한 휴리스틱 (서버 폴백용).
 * @param {{ kind: string, itemName?: string, name?: string }[]} resolved
 */
function heuristicEquipmentNameFromResolved(resolved) {
  const names = (resolved || [])
    .map((m) => (m.kind === 'catch' ? m.itemName : m.name))
    .map((n) => String(n != null ? n : '').trim())
    .filter((x) => x.length > 0);
  if (names.length === 0) return '이름 없는 무기';
  if (names.length === 2) {
    const a = clampPart(names[0], 10);
    const b = clampPart(names[1], 10);
    const link = endsWithBatchimKo(a) ? '과' : '와';
    let s = `${a}${link} ${b}의 무기`;
    if (s.length <= MAX_EQUIP_NAME) return s;
    s = `${a}·${b}의 무기`;
    return s.slice(0, MAX_EQUIP_NAME);
  }
  if (names.length === 3) {
    const p = names.map((x) => clampPart(x, 7)).join('·');
    return `${p}의 무기`.slice(0, MAX_EQUIP_NAME);
  }
  const a0 = clampPart(names[0], 8);
  const a1 = clampPart(names[1], 6);
  return `${a0}·${a1} 외 ${names.length - 2}가지 재료 무기`.slice(0, MAX_EQUIP_NAME);
}

module.exports = { heuristicEquipmentNameFromResolved };
