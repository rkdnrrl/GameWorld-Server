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
  { id: 'silver', name: '은괴', emoji: '⚪', keywords: ['은', 'silver', '실버'] },
  { id: 'gold', name: '금괴', emoji: '🟡', keywords: ['금', 'gold', '골드'] },
  { id: 'iron', name: '철괴', emoji: '⛓️', keywords: ['철', '강철', 'iron', 'steel'] },
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
  { id: 'plasma', name: '플라즈마핵', emoji: '⚡', keywords: ['전기', '번개', 'plasma', '플라즈마'] },
  { id: 'battery', name: '배터리합재', emoji: '🔋', keywords: ['배터리', 'battery', '셀', 'cell'] },
  { id: 'circuit', name: '회로합금', emoji: '🧩', keywords: ['회로', 'circuit', 'pcb', '칩', 'chip'] },
  { id: 'glass', name: '유리액', emoji: '🫙', keywords: ['유리', 'glass', '렌즈', 'lens'] },
  { id: 'fiber', name: '광섬유편', emoji: '🧵', keywords: ['광섬유', 'fiber', 'fibre'] },
  { id: 'ceramic', name: '세라믹분말', emoji: '🧱', keywords: ['세라믹', 'ceramic', '점토', 'clay'] },
  { id: 'cement', name: '시멘트가루', emoji: '🏗️', keywords: ['시멘트', 'cement'] },
  { id: 'concrete', name: '콘크리트편', emoji: '🧱', keywords: ['콘크리트', 'concrete'] },
  { id: 'sand', name: '정제모래', emoji: '🏜️', keywords: ['모래', 'sand'] },
  { id: 'limestone', name: '석회분말', emoji: '🪨', keywords: ['석회', 'limestone'] },
  { id: 'granite', name: '화강암편', emoji: '🪨', keywords: ['화강암', 'granite'] },
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
  { id: 'resin', name: '수지덩어리', emoji: '🪵', keywords: ['수지', 'resin', '나무', 'wood', '목재'] },
  { id: 'rubber', name: '고무덩어리', emoji: '🛞', keywords: ['고무', 'rubber', '라텍스', 'latex'] },
  { id: 'plastic', name: '플라스틱편', emoji: '🧴', keywords: ['플라스틱', 'plastic', '폴리머', 'polymer'] },
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
  { id: 'keratin', name: '생체분말', emoji: '🦴', keywords: ['뼈', 'bone', '가죽', 'hide', '비늘', 'scale'] },
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

function inferSmeltProductFromMaterialName(materialName) {
  const n = String(materialName || '');
  for (let i = 0; i < SMELT_RULES.length; i += 1) {
    if (SMELT_RULES[i].test(n)) return { ...SMELT_RULES[i].out };
  }
  return { id: 'slag', name: '고철', emoji: '🔩' };
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
  metaForProductId,
  ALLOWED_IDS,
};
