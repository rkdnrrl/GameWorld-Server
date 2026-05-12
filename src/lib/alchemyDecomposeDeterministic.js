'use strict';

const {
  normalizeElementSymbol,
  isValidElementSymbol,
  getAtomicNumberForSymbol,
} = require('./periodicElementSymbols');

/**
 * @typedef {{ name: string, itemType?: string|null, kind?: string|null, recipeId?: string|null }} DecomposeSlotHint
 */

/** 표시용 한글 원소명 (자주 나오는 기호 위주) */
const ELEMENT_NAME_KO = {
  H: '수소',
  He: '헬륨',
  Li: '리튬',
  Be: '베릴륨',
  B: '붕소',
  C: '탄소',
  N: '질소',
  O: '산소',
  F: '플루오린',
  Ne: '네온',
  Na: '나트륨',
  Mg: '마그네슘',
  Al: '알루미늄',
  Si: '규소',
  P: '인',
  S: '황',
  Cl: '염소',
  Ar: '아르곤',
  K: '칼륨',
  Ca: '칼슘',
  Ti: '티타늄',
  Cr: '크롬',
  Mn: '망간',
  Fe: '철',
  Co: '코발트',
  Ni: '니켈',
  Cu: '구리',
  Zn: '아연',
  As: '비소',
  Se: '셀레늄',
  Br: '브롬',
  Ag: '은',
  Sn: '주석',
  I: '아이오딘',
  Ba: '바륨',
  Au: '금',
  Hg: '수은',
  Pb: '납',
  U: '우라늄',
  W: '텅스텐',
  Pt: '백금',
};

/**
 * 이름·종류 키워드로 원소 기호를 누적한다. (괄호 조성이 없을 때만 쓰이며, 키워드 경로는 슬롯당 기호 중복 없음)
 * 긴 키워드를 앞에 두면 부분 일치 충돌을 줄일 수 있다.
 * @type {{ patterns: string[], symbols: string[], rationale: string }[]}
 */
const KEYWORD_RULES = [
  { patterns: ['스테인리스', '스테인레스', 'stainless'], symbols: ['Fe', 'Cr', 'Ni'], rationale: '스테인리스 강' },
  { patterns: ['청동', '브론즈', 'bronze'], symbols: ['Cu', 'Sn'], rationale: '청동(구리·주석)' },
  { patterns: ['황동', 'brass'], symbols: ['Cu', 'Zn'], rationale: '황동(구리·아연)' },
  { patterns: ['납땜', '땜납', 'solder'], symbols: ['Sn', 'Pb'], rationale: '땜납(주석·납)' },
  { patterns: ['알루미늄', '알루미', 'aluminum', 'aluminium'], symbols: ['Al'], rationale: '알루미늄' },
  { patterns: ['황금', '순금', '금괴', '금테', '골드', 'gold'], symbols: ['Au'], rationale: '금' },
  { patterns: ['순은', '은박', '은선', '은테', '은침', '은가루', '실버', 'silver'], symbols: ['Ag'], rationale: '은' },
  { patterns: ['녹슨', '녹승', '산화철', 'rust'], symbols: ['Fe', 'O'], rationale: '산화된 철' },
  { patterns: ['형강', '플랜지', '브라켓', '브라킷', '베어링', '기어', '샤프트', '철판', '철근', '철사', '와이어코일'], symbols: ['Fe'], rationale: '강철·기계 부품' },
  { patterns: ['강철', '스틸', 'steel', '쇠붙이'], symbols: ['Fe'], rationale: '철·강철' },
  { patterns: ['구리', '동관', '동선', 'copper'], symbols: ['Cu'], rationale: '구리' },
  { patterns: ['전선', '케이블', '회로', 'pcb', '반도체', '마더보드'], symbols: ['Cu', 'Si', 'Au'], rationale: '전자·회로 재질' },
  { patterns: ['납', '연광', 'lead'], symbols: ['Pb'], rationale: '납' },
  { patterns: ['아연', 'zinc'], symbols: ['Zn'], rationale: '아연' },
  { patterns: ['주석', 'tin'], symbols: ['Sn'], rationale: '주석' },
  { patterns: ['니켈', 'nickel'], symbols: ['Ni'], rationale: '니켈' },
  { patterns: ['크롬', 'chrome'], symbols: ['Cr'], rationale: '크롬' },
  { patterns: ['망간'], symbols: ['Mn'], rationale: '망간' },
  { patterns: ['코발트'], symbols: ['Co'], rationale: '코발트' },
  { patterns: ['티타늄', 'titanium'], symbols: ['Ti'], rationale: '티타늄' },
  { patterns: ['텅스텐', 'tungsten'], symbols: ['W'], rationale: '텅스텐' },
  { patterns: ['마그네슘'], symbols: ['Mg'], rationale: '마그네슘' },
  { patterns: ['칼슘', '석회', '대리석', '석회암'], symbols: ['Ca', 'C', 'O'], rationale: '석회·탄산염' },
  { patterns: ['칼륨'], symbols: ['K'], rationale: '칼륨' },
  { patterns: ['나트륨', '소다'], symbols: ['Na'], rationale: '나트륨' },
  { patterns: ['리튬', '배터리'], symbols: ['Li'], rationale: '리튬·전지' },
  { patterns: ['우라늄', '방사능', '핵'], symbols: ['U'], rationale: '방사성 금속(게임)' },
  { patterns: ['백금', '플래티넘', 'platinum'], symbols: ['Pt'], rationale: '백금' },
  { patterns: ['수은', '머큐리', 'mercury'], symbols: ['Hg'], rationale: '수은' },
  { patterns: ['유리', '유리잔', '프리즘', '렌즈', 'glass', '실리카'], symbols: ['Si', 'O'], rationale: '규산염·유리' },
  { patterns: ['모래', '석영', 'quartz'], symbols: ['Si', 'O'], rationale: '석영·모래' },
  { patterns: ['물', '얼음', 'ice', '바닷물', '해수', '소금물'], symbols: ['H', 'O'], rationale: '물·용액' },
  { patterns: ['소금', '식염', '염화'], symbols: ['Na', 'Cl'], rationale: '염' },
  { patterns: ['대기', '공기'], symbols: ['N', 'O'], rationale: '공기 성분' },
  { patterns: ['암모니아', '암모니'], symbols: ['N', 'H'], rationale: '암모니아' },
  { patterns: ['질소'], symbols: ['N'], rationale: '질소' },
  { patterns: ['산소'], symbols: ['O'], rationale: '산소' },
  { patterns: ['수소'], symbols: ['H'], rationale: '수소' },
  { patterns: ['유황', 'sulfur', '황산'], symbols: ['S'], rationale: '황' },
  { patterns: ['인산', 'phosphorus'], symbols: ['P'], rationale: '인' },
  { patterns: ['플루오린', '불소'], symbols: ['F'], rationale: '플루오린' },
  { patterns: ['염소', '표백', 'bleach'], symbols: ['Cl'], rationale: '염소' },
  { patterns: ['탄소', '그래파이트', '석탄', '숯', '다이아'], symbols: ['C'], rationale: '탄소·탄소질' },
  { patterns: ['나무', '목재', '종이', '펄프', '천', '면', '실크', '가죽', '플라스틱', '고무'], symbols: ['C', 'H', 'O'], rationale: '유기 고분자·생활 재질' },
  { patterns: ['석유', '윤활유', '기름', '오일', 'oil'], symbols: ['C', 'H'], rationale: '탄화수소' },
  { patterns: ['고등어', '멸치', '청어', '생선', '물고기', '해파리', '문어', '오징어', '새우', '게', '조개', '살코기'], symbols: ['C', 'H', 'O', 'N', 'P'], rationale: '생체·해산 유기물' },
  { patterns: ['우주', '성운', '네뷸라', '플라즈마', '이온', '블랙홀', '암흑', '양자', '차원'], symbols: ['H', 'He', 'C', 'Fe'], rationale: '우주·에너지 재질(게임)' },
];

function normSpaces(s) {
  return String(s != null ? s : '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** 조합 산출물 분해 시 증발(원소 미적립) — 튜닝 가능 */
const COMPOSE_SUBLIMATE_TOTAL = 0.025;
/** TOTAL 구간 직후 ~ 이 값까지 누적이면 부분 증발 구간 */
const COMPOSE_SUBLIMATE_PARTIAL_CUMULATIVE = 0.025 + 0.11;
/** 부분 증발 구간에서 원소 하나가 날아갈 확률(독립 시행) */
const COMPOSE_SUBLIMATE_EACH_DROP = 0.28;

/**
 * @param {string[]} syms
 * @param {() => number} rng — [0,1)
 * @returns {{ syms: string[], meta?: { kind: 'total' | 'partial', before: number, after?: number, lost?: number } }}
 */
function applyComposeArtifactSublimate(syms, rng) {
  const before = syms.length;
  if (before === 0) return { syms: [] };
  const r = rng();
  if (r < COMPOSE_SUBLIMATE_TOTAL) {
    return { syms: [], meta: { kind: 'total', before, after: 0, lost: before } };
  }
  if (r < COMPOSE_SUBLIMATE_PARTIAL_CUMULATIVE) {
    const kept = syms.filter(() => rng() >= COMPOSE_SUBLIMATE_EACH_DROP);
    const after = kept.length;
    return {
      syms: kept,
      meta: {
        kind: 'partial',
        before,
        after,
        lost: before - after,
      },
    };
  }
  return { syms: syms.slice() };
}

function isComposeArtifactDecomposeSlot(slot) {
  return String(slot.itemType || '').toLowerCase() === 'artifact';
}

/** 이름 안의 `(Fe)` `(H)` … IUPAC 기호만 순서·중복 유지해 수집 (조합 산출물 접미사용) */
function parenSymbolSequence(name) {
  const re = /\(([A-Za-z]{1,3})\)/g;
  const out = [];
  let m;
  while ((m = re.exec(name)) !== null) {
    const sym = normalizeElementSymbol(m[1]);
    if (sym && isValidElementSymbol(sym)) out.push(sym);
  }
  return out;
}

/** @param {string} normName */
function symbolsFromKeywordRules(normName) {
  const hay = normName.toLowerCase();
  const map = new Map();
  for (const rule of KEYWORD_RULES) {
    const hit = rule.patterns.some((p) => hay.includes(String(p).toLowerCase()));
    if (!hit) continue;
    for (const s of rule.symbols) {
      const sym = normalizeElementSymbol(s);
      if (sym && isValidElementSymbol(sym) && !map.has(sym)) {
        map.set(sym, rule.rationale);
      }
    }
  }
  return map;
}

/** @param {DecomposeSlotHint} slot */
function fallbackSymbolsForSlot(slot) {
  const t = String(slot.itemType || '').toLowerCase();
  if (t === 'fish' || t === 'creature') return ['C', 'H', 'O', 'N', 'P'];
  if (t === 'debris' || t === 'scrap' || t === 'cosmic') return ['Fe', 'C', 'Cu'];
  if (t === 'crystal') return ['Si', 'O'];
  if (t === 'artifact') return ['Si', 'Al', 'Cu'];
  if (String(slot.kind || '').toLowerCase() === 'equipment') return ['Fe', 'C', 'Ni'];
  return ['C', 'H', 'O'];
}

/**
 * 슬롯마다 원소 후보를 모은 뒤 이어붙인다.
 * - 이름에 `(H)(O)` 괄호 조성이 있으면 **그것만** 사용(조합 산출물·기호 접미사).
 * - 없으면 키워드 → 없으면 itemType 폴백(기호당 슬롯당 1회).
 * - 여러 슬롯이면 리스트를 순서대로 합쳐 stash에 기호별로 그만큼 +1.
 * - `itemType: artifact` 이고 이름에 괄호 조성이 있으면(조합 산출물) 분해 시 낮은 확률로 원소가 증발해 적립되지 않을 수 있음.
 * @param {DecomposeSlotHint[]} hints
 * @param {{ rng?: () => number }} [opts]
 * @returns {{ elements: { symbol: string, nameKo: string, atomicNumber?: number, rationaleKo: string }[], reason?: string, sublimate?: object[] }}
 */
function decomposeMaterialsDeterministic(hints, opts = {}) {
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  const list = Array.isArray(hints) ? hints.filter((h) => h && String(h.name || '').trim()) : [];
  if (list.length === 0) {
    return { elements: [], reason: 'empty_names' };
  }

  /** @type {{ symbol: string, rationaleKo: string }[]} */
  const combined = [];
  /** @type {object[]} */
  const sublimate = [];

  for (let slotIndex = 0; slotIndex < list.length; slotIndex += 1) {
    const slot = list[slotIndex];
    const rawName = String(slot.name || '').trim();
    const norm = normSpaces(rawName);

    const parenSyms = parenSymbolSequence(rawName);
    if (parenSyms.length > 0) {
      let outSyms = parenSyms;
      if (isComposeArtifactDecomposeSlot(slot)) {
        const sub = applyComposeArtifactSublimate(parenSyms, rng);
        outSyms = sub.syms;
        if (sub.meta) {
          const m = sub.meta;
          if (m.kind === 'total' || (m.kind === 'partial' && m.lost > 0)) {
            sublimate.push({ slotIndex, itemName: rawName.slice(0, 120), ...m });
          }
        }
      }
      for (const sym of outSyms) {
        combined.push({ symbol: sym, rationaleKo: '이름 괄호 속 원소 조성' });
      }
      continue;
    }

    const slotMap = new Map();
    const fromKw = symbolsFromKeywordRules(norm);
    fromKw.forEach((why, sym) => {
      if (!slotMap.has(sym)) slotMap.set(sym, why);
    });

    if (slotMap.size === 0) {
      for (const s of fallbackSymbolsForSlot(slot)) {
        const sym = normalizeElementSymbol(s);
        if (sym && isValidElementSymbol(sym) && !slotMap.has(sym)) {
          slotMap.set(sym, '재료 종류·이름 기본 규칙(게임)');
        }
      }
    }

    slotMap.forEach((why, sym) => {
      combined.push({ symbol: sym, rationaleKo: why });
    });
  }

  const elements = combined.map(({ symbol, rationaleKo }) => {
    const z = getAtomicNumberForSymbol(symbol);
    const nameKo = ELEMENT_NAME_KO[symbol] || '';
    return {
      symbol,
      nameKo,
      atomicNumber: z,
      rationaleKo: String(rationaleKo || '').slice(0, 200),
    };
  });

  return { elements, sublimate: sublimate.length ? sublimate : undefined };
}

module.exports = {
  decomposeMaterialsDeterministic,
  ELEMENT_NAME_KO,
  parenSymbolSequence,
  applyComposeArtifactSublimate,
};
