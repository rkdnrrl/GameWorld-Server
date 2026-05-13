'use strict';

/**
 * 제작 장비용 PixelLab 스프라이트 (이름·티어 기반).
 * ai.js 낚시 스프라이트와 동일 API, 프롬프트만 장비에 맞게 단순화.
 */

const PIXELLAB_BASE_URL = 'https://api.pixellab.ai/v1';

const PIXEL_NEGATIVE =
  'photograph, photo realistic, 3d render, octane, smooth shading, subsurface scatter, ' +
  'wide establishing shot, tiny subject, panorama, landscape, sky, stars, nebula, galaxy, ' +
  'underwater, ocean, fish, tentacles, anime character, human face, hands, body, ' +
  'text, caption, watermark, logo, signature, QR, HUD, UI frame, speech bubble, ' +
  'motion blur, depth of field bokeh, jpeg artifacts, empty blank canvas, collage, split screen, ' +
  'wrong item type, unrelated industrial piston, random hydraulic cylinder, plain metal pipe unrelated to title';

const RARITY_MOOD = {
  common: 'modest worn materials muted palette',
  rare: 'richer teal-lavender accent subtle glow',
  epic: 'bold violet-gold accent energetic edge glow',
  legendary: 'dramatic sun-gold rim dark core mythical focus',
};

/**
 * 한국어 장비 이름에서 무기/방어구 종류를 추출해 영어 실루엣 힌트로 변환.
 * FORM 배열 키워드 + 일반 장비 키워드를 순서대로 검사 (긴 키워드 우선).
 *
 * @param {string} name — 한국어 장비 이름
 * @returns {string} 영어 실루엣 설명 (매칭 없으면 빈 문자열)
 */
function weaponHintFromKoreanName(name) {
  const n = String(name || '');

  // 긴 키워드를 앞에 두어 하위 문자열 오탐 방지 (미늘창 > 창)
  const TABLE = [
    // FORM 목록 매핑
    ['미늘창',  'halberd polearm long shaft wide curved blade'],
    ['대검',    'great sword broad two-handed sword long wide blade'],
    ['단검',    'dagger short blade pointed'],
    ['장검',    'longsword straight long one-handed sword'],
    ['투창',    'javelin throwing spear slim long shaft pointed tip'],
    ['철퇴',    'flail mace spiked ball on chain handle'],
    ['도끼',    'axe wide curved blade on handle'],
    ['방패',    'shield round or kite shaped defensive equipment'],
    ['망치',    'warhammer large hammer head on long handle'],
    ['비수',    'stiletto thin needle blade dagger'],
    ['원반',    'chakram disc throwing ring circular blade'],
    ['창',      'spear long pole pointed tip'],
    ['검',      'sword straight blade hilt guard'],
    ['낫',      'scythe curved long blade on pole war-scythe'],
    // 추가 일반 장비 키워드
    ['활',      'bow recurve or longbow'],
    ['석궁',    'crossbow horizontal bow with stock'],
    ['지팡이',  'staff long wooden rod orb or gem on top'],
    ['완드',    'wand short magical rod glowing tip'],
    ['갑옷',    'full plate armor chestplate pauldrons'],
    ['흉갑',    'breastplate chest armor'],
    ['투구',    'helm helmet armor headgear visor'],
    ['장갑',    'gauntlets armored gloves'],
    ['부츠',    'armored boots greaves'],
    ['반지',    'ring gemstone ornate band'],
    ['목걸이',  'amulet necklace pendant gem'],
    ['망토',    'cloak long flowing fabric cape'],
    ['벨트',    'belt girdle leather straps buckle'],
    ['로브',    'robe long mage cloth garment'],
  ];

  for (const [ko, en] of TABLE) {
    if (n.includes(ko)) return en;
  }
  return '';
}

function buildEquipmentImagePrompt(name, tier, visualHintEn) {
  const clean = String(name || '').trim().slice(0, 48);
  const r = String(tier || 'common').toLowerCase();
  const mood = RARITY_MOOD[r] || RARITY_MOOD.common;

  // visualHintEn(Gemini 제공) 우선, 없으면 이름에서 자동 추출
  const rawHint = typeof visualHintEn === 'string' && visualHintEn.trim()
    ? visualHintEn.trim()
    : weaponHintFromKoreanName(clean);
  const hint = rawHint.slice(0, 220);

  const primary = hint
    ? `PRIMARY SILHOUETTE — draw exactly this object, no substitution: ${hint}`
    : 'single recognizable RPG equipment piece matching the item title category (sword axe mace spear shield helm gloves boots belt ring cloak staff bow) — if title is ambiguous draw a plain shortsword';

  const parts = [
    'SNES era 16-bit pixel art RPG equipment inventory icon',
    'single object centered large on canvas thick chunky pixels',
    primary,
    'readable chunky silhouette readable at 32px not abstract cube',
    mood,
    'isolated subject empty void around object alpha friendly',
    clean
      ? `Korean title flavor only never paint letters or text: ${JSON.stringify(clean)}`
      : null,
    'materials leather cloth wood iron bronze as implied by PRIMARY line not generic sci-fi scrap',
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * @param {string} name
 * @param {string} tier
 * @param {AbortSignal} [signal]
 * @param {string|null} [visualHintEn] — Gemini 영어 실루엣(이름과 동일 물건)
 * @returns {Promise<string|null>} data:image/png;base64,... 또는 null
 */
async function generateCraftedEquipmentPixelArt(name, tier, signal, visualHintEn) {
  const secret = String(process.env.PIXELLAB_SECRET || '').trim();
  if (!secret) return null;

  const description = buildEquipmentImagePrompt(name, tier, visualHintEn);

  try {
    const plRes = await fetch(`${PIXELLAB_BASE_URL}/generate-image-pixflux`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        description,
        image_size: { width: 64, height: 64 },
        negative_description: PIXEL_NEGATIVE,
        text_guidance_scale: 7.25,
        no_background: true,
      }),
      signal: signal || undefined,
    });

    if (!plRes.ok) {
      const errText = await plRes.text().catch(() => '');
      console.error('[PixelLab equipment] error:', plRes.status, errText.slice(0, 400));
      return null;
    }

    const plData = await plRes.json();
    const b64 = plData?.image?.base64;
    if (!b64) {
      console.warn('[PixelLab equipment] no base64');
      return null;
    }

    const cost = plData?.usage?.usd;
    if (cost) console.log(`[PixelLab equipment] "${String(name).slice(0, 32)}" (${tier}) — $${cost.toFixed(5)}`);

    return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  } catch (err) {
    console.error('[PixelLab equipment] fetch error:', err && err.message ? err.message : err);
    return null;
  }
}

module.exports = { generateCraftedEquipmentPixelArt, buildEquipmentImagePrompt };
