'use strict';

/** Singleplay-Game5 `SMELT_RULES` 와 동일 — 서버에서 재료명으로 산출물 결정 */
const SMELT_RULES = [
  {
    test: (n) => /유리|glass|프리즘|결정|크리스탈|수정|lens/i.test(n),
    out: { id: 'glass', name: '유리액', emoji: '🫙' },
  },
  {
    test: (n) => /금|gold|골드/i.test(n),
    out: { id: 'gold', name: '금괴', emoji: '🟡' },
  },
  {
    test: (n) => /구리|copper|동|bronze/i.test(n),
    out: { id: 'copper', name: '구리괴', emoji: '🟠' },
  },
  {
    test: (n) => /은|silver|실버/i.test(n),
    out: { id: 'silver', name: '은괴', emoji: '⚪' },
  },
  {
    test: (n) => /철|강철|패널|회로|금속|잔해|쓰레기|컨테이너|iron|steel/i.test(n),
    out: { id: 'iron', name: '철괴', emoji: '⛓️' },
  },
];

const ALLOWED_IDS = new Set(['glass', 'gold', 'copper', 'silver', 'iron', 'slag']);

function inferSmeltProductFromMaterialName(materialName) {
  const n = String(materialName || '');
  for (let i = 0; i < SMELT_RULES.length; i += 1) {
    if (SMELT_RULES[i].test(n)) return { ...SMELT_RULES[i].out };
  }
  return { id: 'slag', name: '고철', emoji: '🔩' };
}

function metaForProductId(productId) {
  const id = String(productId || '');
  const all = [...SMELT_RULES.map((r) => r.out), { id: 'slag', name: '고철', emoji: '🔩' }];
  const hit = all.find((x) => x.id === id);
  return hit || { id, name: id, emoji: '◆' };
}

module.exports = {
  inferSmeltProductFromMaterialName,
  metaForProductId,
  ALLOWED_IDS,
};
