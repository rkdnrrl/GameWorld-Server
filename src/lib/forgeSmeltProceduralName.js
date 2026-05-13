'use strict';

/**
 * 용광로 산출물(smelt)만으로 동적 제련할 때 쓰는 절차적 장비 이름.
 * 재료 순서·productId 다중성이 시드가 되어 같은 조합이면 같은 이름이 나온다.
 *
 * 이론상 **서로 다른** 이름 개수(휠 독립 곱, 시드가 충분히 퍼지면 근사적으로 모두 등장 가능):
 *   QUALITY(18) × MID(15) × FORM(14) × VARIANT(10) = 37_800
 */

const QUALITY = [
  '정제',
  '초순',
  '불순',
  '재결정',
  '증류',
  '압축',
  '저온',
  '고온',
  '합성',
  '주조',
  '응축',
  '편석',
  '분말',
  '슬래그',
  '증착',
  '도금',
  '탈가스',
  '재용해',
];

const MID = [
  '합금',
  '복합재',
  '세라믹계',
  '금속계',
  '합철',
  '경합금',
  '중합금',
  '초경합',
  '내열합',
  '방열합',
  '전도합',
  '절연합',
  '나노합',
  '다층합',
  '메탈릭',
];

// 슬롯별 장비 형태 (절차적 이름 FORM 휠)
const FORM_BY_SLOT = {
  weapon:    ['검','창','도끼','방패','철퇴','망치','낫','단검','대검','투창','원반','장검','미늘창','비수'],
  head:      ['투구','헬멧','두건','면갑','철모','가면','봉황관','두갑','마법사모자','기사투구','철각모','두갑환','쾌두건','왕관'],
  chest:     ['흉갑','갑옷','판금갑옷','사슬갑옷','가죽갑옷','로브','전투복','철갑의','기사갑옷','마법사로브','조끼','흉심갑','천갑옷','방호갑'],
  pants:     ['각반','정강이받이','하의갑','전투하의','가죽하의','갑각하의','경갑하의','철갑하의','기사하의','마법하의','판금각반','강화각반','전투각반','중갑하의'],
  gloves:    ['건틀릿','장갑','철장갑','가죽장갑','마법장갑','전투장갑','손목갑','경갑장갑','판금장갑','기사장갑','암흑장갑','봉황장갑','손갑','중갑장갑'],
  boots:     ['부츠','발갑','전투화','경갑화','판금화','기사화','마법화','가죽부츠','철갑화','강화부츠','발등갑','철각','철발갑','중갑화'],
  accessory: ['반지','목걸이','팔찌','귀걸이','아뮬렛','부적','마법구슬','탈리스만','토템','문장','수호석','전투반지','결정반지','마력구슬'],
};

const FORM = FORM_BY_SLOT.weapon; // 하위 호환

const VARIANT = ['', '재', '연', '초', '극', '저', '고', '균', '내', '외'];

const MAX_EQUIP_NAME = 120;

const SMELT_PROCEDURAL_NAME_OUTCOMES =
  QUALITY.length * MID.length * FORM.length * VARIANT.length;

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * resolved 행이 전부 smelt 인지.
 * @param {{ kind?: string }[]} resolved
 */
function resolvedMaterialsAreSmeltOnly(resolved) {
  const rows = Array.isArray(resolved) ? resolved : [];
  return rows.length > 0 && rows.every((r) => r && r.kind === 'smelt');
}

/**
 * 산출물 전용 절차적 이름 (한글, 길이 제한).
 * @param {{ kind: string, id?: string }[]} resolved — smelt 행만 있을 것
 * @param {string} [slot] — weapon|head|chest|pants|gloves|boots|accessory
 */
function proceduralSmeltForgeName(resolved, slot) {
  const rows = Array.isArray(resolved) ? resolved.filter((r) => r && r.kind === 'smelt') : [];
  const formPool = FORM_BY_SLOT[String(slot || 'weapon')] || FORM_BY_SLOT.weapon;
  if (rows.length === 0) return `무명산출${formPool[0]}`;

  const seedKey = rows.map((r) => String(r.id || '').trim().toLowerCase()).sort().join('|');
  const seed = hashSeed(seedKey);
  const rnd = mulberry32(seed);

  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

  const q = pick(QUALITY);
  const m = pick(MID);
  const f = pick(formPool);
  const v = pick(VARIANT);
  const raw = `${q}${v}${m}${f}`;
  return raw.slice(0, MAX_EQUIP_NAME);
}

module.exports = {
  proceduralSmeltForgeName,
  resolvedMaterialsAreSmeltOnly,
  countSmeltProceduralForgeNameOutcomes: () => SMELT_PROCEDURAL_NAME_OUTCOMES,
  SMELT_PROCEDURAL_NAME_OUTCOMES,
};
