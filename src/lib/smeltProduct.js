'use strict';

/** Singleplay-Game5 `SMELT_CATALOG`와 동일 카탈로그 */
const SMELT_CATALOG = [
  { id: 'platinum', name: '백금괴', emoji: '✨', keywords: ['백금', 'platinum'] },
  { id: 'palladium', name: '팔라듐괴', emoji: '🌟', keywords: ['팔라듐', 'palladium'] },
  { id: 'rhodium', name: '로듐편', emoji: '💠', keywords: ['로듐', 'rhodium'] },
  { id: 'iridium', name: '이리듐편', emoji: '🛰️', keywords: ['이리듐', 'iridium'] },
  { id: 'tungsten', name: '텅스텐괴', emoji: '🧲', keywords: ['텅스텐', 'tungsten', 'wolfram'] },
  { id: 'titanium', name: '티타늄괴', emoji: '🛡️', keywords: ['티타늄', 'titanium'] },
  { id: 'molybdenum', name: '몰리브덴편', emoji: '🔩', keywords: ['몰리브덴', 'molybdenum'] },
  { id: 'chromium', name: '크로뮴괴', emoji: '🪞', keywords: ['크롬', 'chromium'] },
  { id: 'vanadium', name: '바나듐편', emoji: '🧪', keywords: ['바나듐', 'vanadium'] },
  { id: 'niobium', name: '니오븀편', emoji: '🧿', keywords: ['니오븀', 'niobium'] },
  { id: 'cobalt', name: '코발트괴', emoji: '🔵', keywords: ['코발트', 'cobalt'] },
  { id: 'nickel', name: '니켈괴', emoji: '🪙', keywords: ['니켈', 'nickel'] },
  { id: 'manganese', name: '망간괴', emoji: '🟤', keywords: ['망간', 'manganese'] },
  { id: 'zinc', name: '아연괴', emoji: '⚙️', keywords: ['아연', 'zinc'] },
  { id: 'tin', name: '주석괴', emoji: '🔘', keywords: ['주석', 'tin'] },
  { id: 'lead', name: '납괴', emoji: '◼️', keywords: ['납', 'lead'] },
  { id: 'bismuth', name: '비스무트편', emoji: '🧊', keywords: ['비스무트', 'bismuth'] },
  { id: 'antimony', name: '안티모니편', emoji: '🫧', keywords: ['안티모니', 'antimony'] },
  { id: 'lithium', name: '리튬결정', emoji: '🔋', keywords: ['리튬', 'lithium'] },
  { id: 'magnesium', name: '마그네슘괴', emoji: '🧯', keywords: ['마그네슘', 'magnesium'] },
  { id: 'aluminum', name: '알루미늄괴', emoji: '🔧', keywords: ['알루미늄', 'aluminum', 'aluminium'] },
  { id: 'copper', name: '구리괴', emoji: '🟠', keywords: ['구리', 'copper', '동'] },
  /** 단독 '은'은 "녹은·검은" 등에 오인 → 긴 토큰만 */
  { id: 'silver', name: '은괴', emoji: '⚪', keywords: ['실버', 'silver', '순은', '백은', '925은', '은괴', '은선', '은도금', '은장', '은박', '스털링'] },
  { id: 'gold', name: '금괴', emoji: '🟡', keywords: ['순금', '황금', 'gold', '골드', '금괴', '금도금', '24k', '18k', '캐럿'] },
  /** 단독 '철'은 "비철" 등에 오인 */
  { id: 'iron', name: '철괴', emoji: '⛓️', keywords: ['강철', '연철', '스테인리스', '스테인', 'iron', 'steel', '철근', '철판', '철사', '철망', '철창', '철퇴', '철심', '철벽', '철광', '철가루', 'scrap iron'] },
  {
    id: 'circuit',
    name: '회로합금',
    emoji: '🧩',
    keywords: [
      '비철',
      '기계식키보드',
      '유선키보드',
      '무선키보드',
      '키보드',
      'keyboard',
      '게이밍마우스',
      '무선마우스',
      '마우스',
      'mouse',
      '게임패드',
      'gamepad',
      '조이스틱',
      '컨트롤러',
      'controller',
      '마우스패드',
      '모니터',
      'monitor',
      '디스플레이',
      'lcd',
      'oled',
      '노트북',
      '태블릿',
      '스마트폰',
      '그래픽카드',
      'gpu',
      'cpu',
      'ram',
      'ddr',
      'ssd',
      'm.2',
      '하드디스크',
      '메인보드',
      '마더보드',
      '파워서플라이',
      'usb허브',
      'usb',
      '충전기',
      '어댑터',
      '웹캠',
      'webcam',
      '헤드셋',
      'headset',
      '이어폰',
      '스피커',
      '마이크',
      '회로',
      'circuit',
      'pcb',
      '칩',
      'chip',
      '메모리',
      '프로세서',
      'nvidia',
      'amd',
      '인텔',
      'intel',
    ],
  },
  { id: 'rareearth', name: '희토류분말', emoji: '🧬', keywords: ['희토류', 'rare earth', 'rareearth'] },
  { id: 'neodymium', name: '네오디뮴편', emoji: '🧲', keywords: ['네오디뮴', 'neodymium'] },
  { id: 'lanthanum', name: '란타넘편', emoji: '🔬', keywords: ['란타넘', 'lanthanum'] },
  { id: 'cerium', name: '세륨편', emoji: '🔭', keywords: ['세륨', 'cerium'] },
  { id: 'samarium', name: '사마륨편', emoji: '🛰️', keywords: ['사마륨', 'samarium'] },
  { id: 'yttrium', name: '이트륨편', emoji: '🧱', keywords: ['이트륨', 'yttrium'] },
  { id: 'gallium', name: '갈륨방울', emoji: '💧', keywords: ['갈륨', 'gallium'] },
  { id: 'germanium', name: '게르마늄편', emoji: '🖲️', keywords: ['게르마늄', 'germanium'] },
  { id: 'indium', name: '인듐편', emoji: '📱', keywords: ['인듐', 'indium'] },
  { id: 'selenium', name: '셀레늄결정', emoji: '🔺', keywords: ['셀레늄', 'selenium'] },
  { id: 'tellurium', name: '텔루륨결정', emoji: '🔻', keywords: ['텔루륨', 'tellurium'] },
  { id: 'hafnium', name: '하프늄편', emoji: '⚛️', keywords: ['하프늄', 'hafnium'] },
  { id: 'tantalum', name: '탄탈럼편', emoji: '🔌', keywords: ['탄탈럼', 'tantalum'] },
  { id: 'zirconium', name: '지르코늄편', emoji: '🧷', keywords: ['지르코늄', 'zirconium'] },
  { id: 'uranium', name: '우라늄조각', emoji: '☢️', keywords: ['우라늄', 'uranium', '방사능', '핵'] },
  { id: 'silicon', name: '실리콘괴', emoji: '🔷', keywords: ['실리콘', 'silicon'] },
  { id: 'silica', name: '실리카분말', emoji: '◻️', keywords: ['실리카', 'silica', 'quartz', '석영'] },
  { id: 'wafer', name: '웨이퍼조각', emoji: '💿', keywords: ['웨이퍼', 'wafer'] },
  { id: 'graphite', name: '흑연분말', emoji: '⬛', keywords: ['흑연', 'graphite'] },
  { id: 'carbon', name: '탄소덩어리', emoji: '⬛', keywords: ['석탄', 'coal', '탄소', 'carbon'] },
  { id: 'graphene', name: '그래핀편', emoji: '🕸️', keywords: ['그래핀', 'graphene'] },
  { id: 'lithiumsalt', name: '리튬염', emoji: '🧂', keywords: ['전해질', 'electrolyte', '리튬염'] },
  { id: 'plasma', name: '플라즈마핵', emoji: '⚡', keywords: ['번개', 'plasma', '플라즈마'] },
  { id: 'battery', name: '배터리합재', emoji: '🔋', keywords: ['배터리', 'battery', '셀', 'cell'] },
  { id: 'glass', name: '유리액', emoji: '🫙', keywords: ['유리', 'glass', '렌즈', 'lens'] },
  { id: 'fiber', name: '광섬유편', emoji: '🧵', keywords: ['광섬유', 'fiber', 'fibre'] },
  { id: 'ceramic', name: '세라믹분말', emoji: '🧱', keywords: ['도자기', '자기', 'porcelain', '세라믹', 'ceramic', '점토', 'clay'] },
  { id: 'cement', name: '시멘트가루', emoji: '🏗️', keywords: ['시멘트', 'cement'] },
  { id: 'concrete', name: '콘크리트편', emoji: '🧱', keywords: ['콘크리트', 'concrete'] },
  { id: 'sand', name: '정제모래', emoji: '🏜️', keywords: ['모래', 'sand'] },
  { id: 'limestone', name: '석회분말', emoji: '🪨', keywords: ['석회', 'limestone'] },
  { id: 'granite', name: '화강암편', emoji: '🪨', keywords: ['화강암', 'granite', '대리석', 'marble'] },
  { id: 'basalt', name: '현무암편', emoji: '🗿', keywords: ['현무암', 'basalt'] },
  { id: 'asphalt', name: '아스팔트괴', emoji: '🛣️', keywords: ['아스팔트', 'asphalt'] },
  { id: 'sulfur', name: '황결정', emoji: '🟨', keywords: ['황', 'sulfur', 'sulphur'] },
  { id: 'salt', name: '소금결정', emoji: '🧂', keywords: ['소금', 'salt', '염화나트륨'] },
  { id: 'sodaash', name: '소다회', emoji: '⚗️', keywords: ['소다회', 'soda ash'] },
  { id: 'phosphor', name: '인광분말', emoji: '🟩', keywords: ['인광', 'phosphor'] },
  { id: 'phosphate', name: '인산염', emoji: '🧪', keywords: ['인산', 'phosphate'] },
  { id: 'chloride', name: '염화물', emoji: '🫧', keywords: ['염소', 'chlorine', '염화'] },
  { id: 'nitrate', name: '질산염', emoji: '🧫', keywords: ['질산', 'nitrate'] },
  { id: 'ammonia', name: '암모니아염', emoji: '🧴', keywords: ['암모니아', 'ammonia'] },
  { id: 'hydrogen', name: '수소캡슐', emoji: '🫧', keywords: ['수소', 'hydrogen'] },
  { id: 'oxygen', name: '산소캡슐', emoji: '💨', keywords: ['산소', 'oxygen'] },
  { id: 'nitrogen', name: '질소캡슐', emoji: '🌫️', keywords: ['질소', 'nitrogen'] },
  { id: 'helium', name: '헬륨캡슐', emoji: '🎈', keywords: ['헬륨', 'helium'] },
  { id: 'argon', name: '아르곤캡슐', emoji: '🌬️', keywords: ['아르곤', 'argon'] },
  { id: 'resin', name: '수지덩어리', emoji: '🪵', keywords: ['목판', '원목', '대나무', '나무자루', '수지', 'resin', '나무', 'wood', '목재'] },
  { id: 'rubber', name: '고무덩어리', emoji: '🛞', keywords: ['고무', 'rubber', '라텍스', 'latex'] },
  { id: 'plastic', name: '플라스틱편', emoji: '🧴', keywords: ['플라스틱', 'plastic', '폴리머', 'polymer'] },
  {
    id: 'leather',
    name: '가죽편',
    emoji: '🥾',
    keywords: [
      '낡은가죽',
      '가죽장갑',
      '가죽장화',
      '가죽신발',
      '가죽벨트',
      '가죽지갑',
      '가죽소파',
      '가죽시트',
      '가죽재킷',
      '가죽자켓',
      '가죽코트',
      '가죽모자',
      '가죽책',
      '가죽',
      'leather',
      '스웨이드',
      'suede',
      '누벅',
      '합피',
      '인조가죽',
    ],
  },
  {
    id: 'textile',
    name: '면섬유뭉치',
    emoji: '🧶',
    keywords: [
      '면섬유',
      '순면',
      '면티',
      '면원단',
      '면장갑',
      '니트장갑',
      '울장갑',
      '실크장갑',
      '털장갑',
      '코튼',
      'cotton',
      '린넨',
      'linen',
      '데님',
      'denim',
      '폴리에스터',
      '레이온',
      '스웨터',
      '니트',
      '티셔츠',
      '후드티',
      '맨투맨',
      '셔츠',
      '블라우스',
      '청바지',
      '바지',
      '반바지',
      '슬랙스',
      '치마',
      '원피스',
      '패딩',
      '코트',
      '재킷',
      '점퍼',
      '바람막이',
      '양말',
      '스타킹',
      '모자',
      '비니',
      '베레모',
      '스카프',
      '목도리',
      '슬리퍼',
      '운동화',
      '캔버스',
      '섬유',
      '원단',
      '직물',
      '편직',
      '실크',
      '울',
      'wool',
      '패브릭',
      'fabric',
    ],
  },
  { id: 'petro', name: '석유정제물', emoji: '🛢️', keywords: ['석유', 'oil', '원유', 'crude'] },
  { id: 'bitumen', name: '비투멘', emoji: '🛢️', keywords: ['비투멘', 'bitumen', '타르', 'tar'] },
  { id: 'kevlar', name: '아라미드섬유', emoji: '🦺', keywords: ['케블라', 'kevlar', 'aramid'] },
  { id: 'carbonfiber', name: '탄소섬유', emoji: '🧵', keywords: ['탄소섬유', 'carbon fiber', 'carbonfiber'] },
  { id: 'diamond', name: '다이아분말', emoji: '💎', keywords: ['다이아', 'diamond'] },
  { id: 'ruby', name: '루비분말', emoji: '❤️', keywords: ['루비', 'ruby'] },
  { id: 'sapphire', name: '사파이어분말', emoji: '💙', keywords: ['사파이어', 'sapphire'] },
  { id: 'emerald', name: '에메랄드가루', emoji: '🟢', keywords: ['에메랄드', 'emerald'] },
  { id: 'amethyst', name: '자수정가루', emoji: '🟣', keywords: ['자수정', 'amethyst'] },
  { id: 'opal', name: '오팔파편', emoji: '🫧', keywords: ['오팔', 'opal'] },
  { id: 'topaz', name: '토파즈가루', emoji: '🟨', keywords: ['토파즈', 'topaz'] },
  { id: 'garnet', name: '가넷가루', emoji: '🔴', keywords: ['가넷', 'garnet'] },
  { id: 'pearl', name: '진주분말', emoji: '⚪', keywords: ['진주', 'pearl'] },
  { id: 'keratin', name: '생체분말', emoji: '🦴', keywords: ['뼈', 'bone', '비늘', 'scale', '발톱', '뿔', 'horn'] },
  { id: 'chitin', name: '키틴편', emoji: '🪲', keywords: ['키틴', 'chitin', '갑각'] },
  { id: 'protein', name: '단백질덩어리', emoji: '🥩', keywords: ['단백질', 'protein'] },
  { id: 'enzyme', name: '효소응집체', emoji: '🧫', keywords: ['효소', 'enzyme'] },
  { id: 'biofuel', name: '바이오연료', emoji: '🟩', keywords: ['바이오', 'bio', '연료'] },
  { id: 'magma', name: '마그마코어', emoji: '🌋', keywords: ['마그마', 'lava', '용암'] },
  { id: 'cryo', name: '빙결결정', emoji: '🧊', keywords: ['얼음', 'ice', '빙결', '서리', 'frost'] },
];

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeSmeltRule(id, name, emoji, keywords) {
  const words = (Array.isArray(keywords) ? keywords : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const re = words.length > 0 ? new RegExp(words.map((w) => escapeRegex(w)).join('|'), 'i') : /$^/;
  return {
    test: (n) => re.test(String(n || '')),
    out: { id, name, emoji },
  };
}

const SMELT_RULES = SMELT_CATALOG.map((e) => makeSmeltRule(e.id, e.name, e.emoji, e.keywords));
const ALLOWED_IDS = new Set([...SMELT_CATALOG.map((e) => e.id), 'slag']);

/** 한 아이템 녹일 때 나올 수 있는 산출물 종류 상한 */
const MAX_SMELT_YIELDS_PER_ITEM = 3;

function hashMaterialName(s) {
  let h = 2166136261 >>> 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * 재료/장비 이름에 맞는 산출물 productId 1~3개 (규칙 다중 매칭 + 가끔 부산물 slag).
 * @param {string} materialName
 * @returns {string[]}
 */
function inferSmeltProductsFromMaterialName(materialName) {
  const n = String(materialName || '');
  const hits = [];
  for (let i = 0; i < SMELT_RULES.length; i += 1) {
    if (SMELT_RULES[i].test(n)) hits.push(SMELT_RULES[i].out.id);
  }
  const seen = new Set();
  const dedup = [];
  for (const id of hits) {
    if (seen.has(id)) continue;
    seen.add(id);
    dedup.push(id);
    if (dedup.length >= MAX_SMELT_YIELDS_PER_ITEM) break;
  }
  if (dedup.length === 0) return ['slag'];
  if (dedup.length === 1 && dedup[0] !== 'slag') {
    if (hashMaterialName(n) % 5 === 0) return [dedup[0], 'slag'];
  }
  return dedup;
}

/** @deprecated 첫 번째 산출물만 — 다중 녹임은 inferSmeltProductsFromMaterialName 사용 */
function inferSmeltProductFromMaterialName(materialName) {
  const ids = inferSmeltProductsFromMaterialName(materialName);
  const id = ids[0] || 'slag';
  return { ...metaForProductId(id) };
}

function metaForProductId(productId) {
  const id = String(productId || '');
  const all = [...SMELT_CATALOG.map((x) => ({ id: x.id, name: x.name, emoji: x.emoji })), { id: 'slag', name: '고철', emoji: '🔩' }];
  const hit = all.find((x) => x.id === id);
  return hit || { id, name: id, emoji: '◆' };
}

module.exports = {
  SMELT_CATALOG,
  inferSmeltProductFromMaterialName,
  inferSmeltProductsFromMaterialName,
  MAX_SMELT_YIELDS_PER_ITEM,
  metaForProductId,
  ALLOWED_IDS,
};
