const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

const RARITY_KO = {
  common:    '일반',
  rare:      '희귀',
  epic:      '에픽',
  legendary: '전설',
};

/** Singleplay-Game3 고철 야드 UI 등급명 — AI 프롬프트용 */
const RARITY_SCRAP_YARD_KO = {
  common:    '잡철(흔한 스크랩)',
  rare:      '선별(괜찮은 편)',
  epic:      '우량(좋은 편)',
  legendary: '특급(극히 희귀)',
};

const VALID_TYPES = ['fish', 'creature', 'artifact', 'crystal', 'debris', 'cosmic', 'scrap'];

/** 일반·희귀 공유 캐시(shared_pixel_arts.name) — `shared`로 시작하는 키만 사용 */
const SHARED_SCRAPYARD_CACHE_PREFIX = 'shared:scrapyard:';

function sharedScrapyardCacheKey(displayName) {
  const d = String(displayName || '').trim();
  const maxLen = Math.max(1, 100 - SHARED_SCRAPYARD_CACHE_PREFIX.length);
  return `${SHARED_SCRAPYARD_CACHE_PREFIX}${d.slice(0, maxLen)}`;
}

const PIXELLAB_BASE_URL = 'https://api.pixellab.ai/v1';

const TYPE_STYLE = {
  fish:     'space fish, alien aquatic creature, fins and tail, marine life',
  creature: 'alien creature, space monster, living organism, organic body',
  artifact: 'mechanical device, space machine, sci-fi gadget, metallic object, gear or engine or tool',
  crystal:  'glowing crystal, gemstone, mineral shard, geometric facets',
  debris:   'space junk, wreckage, broken machine part, scrap metal, fragment',
  cosmic:   'cosmic entity, energy being, abstract space phenomenon',
  scrap:
    'one chunky industrial metal scrap prop, steel iron alloy, junkyard machine fragment, ' +
    'nuts bolts gears rebar coil plate shard, heavy readable silhouette, fills most of frame, ' +
    'no fish no ocean no creature face no human',
};

/** 한국어 이름 토큰 → PixelLab용 영어 형태 힌트 (긴 키워드 우선) */
const KOREAN_NAME_PIXEL_HINTS = [
  // ── 주방 ──
  ['후라이팬', 'round metal frying pan with long side handle, flat circular pan bottom, skillet cookware shape, handle must be visible, not a cube'],
  ['프라이팬', 'round metal frying pan with long side handle, flat circular pan bottom, skillet cookware shape, not a cube'],
  ['샌드위치프레스', 'hinged sandwich press with two flat plates and handle grip, grill appliance silhouette'],
  ['냄비', 'metal cooking pot with side handles, cylindrical or bulging pot body, lid optional'],
  ['웍', 'round curved wok bowl, one long handle, open top'],
  ['주전자', 'metal kettle with spout and top handle'],
  ['밥솥', 'thick rice cooker pot with domed lid and knob'],
  ['가마솥', 'large iron cauldron with three short legs'],
  ['철솥', 'cast iron dutch oven pot with domed lid'],
  ['밀폐용기', 'rectangular metal food container with snap lid'],
  // ── 욕실·세면 ──
  ['비누', 'oval bar of soap with rounded soft edges, small foam bubbles on top, smooth pastel colored soap bar, not a cube not a box'],
  ['샴푸', 'tall plastic shampoo bottle with flip-top cap, label on front, rounded bottle body'],
  ['린스', 'tall plastic conditioner bottle with flip-top cap, slightly different color from shampoo'],
  ['바디워시', 'squeeze bottle of body wash with pump dispenser, oval bottle shape'],
  ['칫솔', 'toothbrush with long handle and small bristle head, angled neck'],
  ['치약', 'toothpaste tube with screw cap, soft squeezable tube shape with rounded end'],
  ['샤워기', 'handheld shower head with hose, round spray head with holes'],
  ['세면대', 'white ceramic sink basin with faucet tap, bowl shape'],
  // ── 생활·청소 ──
  ['빗자루', 'broom with long wooden handle and wide bristle brush head'],
  ['청소기', 'upright vacuum cleaner with cylindrical body and hose nozzle'],
  ['걸레', 'wet mop with long handle and flat mop head, cleaning cloth'],
  ['쓰레기통', 'round trash can with lid, cylindrical bin shape'],
  ['양동이', 'round bucket with curved handle, open top container'],
  // ── 의류·패션 ──
  ['가방', 'handbag or backpack with straps and buckle clasp'],
  ['지갑', 'bifold leather wallet, folded rectangle with card slots visible'],
  ['벨트', 'leather belt with metal buckle, long strap shape'],
  ['장갑', 'pair of gloves, five-fingered hand covering'],
  // ── 스포츠·운동 ──
  ['덤벨', 'dumbbell with two round weight plates and short center grip bar'],
  ['케틀벨', 'iron kettlebell with round ball body and thick loop handle on top'],
  ['점핑로프', 'jump rope with two handles and looping rope, skipping rope shape, rope arc between handles'],
  ['줄넘기', 'jump rope with two wooden handles and thin rope loop'],
  // ── 전자 ──
  ['키보드', 'flat rectangular keyboard with rows of keys, computer peripheral'],
  ['마우스', 'computer mouse with two buttons and scroll wheel, ergonomic shape'],
  ['이어폰', 'in-ear earphones with two small earbuds and thin wire cable'],
  ['헤드폰', 'over-ear headphones with cushioned ear cups and arching headband'],
  ['충전기', 'small power adapter plug with USB port and prong connectors'],
];

function englishHintFromKoreanItemName(displayName) {
  const n = String(displayName || '');
  for (let i = 0; i < KOREAN_NAME_PIXEL_HINTS.length; i += 1) {
    const row = KOREAN_NAME_PIXEL_HINTS[i];
    const kw = row[0];
    const hint = row[1];
    if (kw && hint && n.includes(kw)) return hint;
  }
  return '';
}

/** 고철 야드(Singleplay-Game3) — 희귀도별 금속·조명 묘사 (픽셀 아이콘용) */
const SCRAP_RARITY_STYLE = {
  common:    'worn rust patina, dull gray brown steel, flat lighting, humble scrap',
  rare:      'cleaner machined steel, cool blue grey highlights, subtle edge gleam',
  epic:      'orange heat glow on edges, welding sparks, stronger metal contrast',
  legendary: 'dark steel with gold trim, ornate bolts, relic-like scrap centerpiece',
};

const RARITY_STYLE = {
  common:    'simple design, muted colors',
  rare:      'blue and purple tones, glowing aura',
  epic:      'red and gold fiery tones, intense glow',
  legendary: 'golden divine radiance, awe-inspiring, ornate details',
};

/** 힌트가 금속/공구류인지 판단 — 금속 묘사를 적용할지 결정 */
const METAL_HINT_KEYWORDS = ['metal', 'iron', 'steel', 'cast', 'alloy', 'gear', 'bolt', 'wrench', 'scrap', 'wire', 'blade'];
function hintIsMetal(hint) {
  const h = (hint || '').toLowerCase();
  return METAL_HINT_KEYWORDS.some((k) => h.includes(k));
}

/** PixelLab은 영어 구도·재질 위주가 안정적 — 한국어 이름은 짧은 무드 힌트로만 */
function buildPixelLabPrompt(displayName, rarity, type, visualEn) {
  const clean = String(displayName || '').trim().slice(0, 48);
  const nameShapeHint = englishHintFromKoreanItemName(clean);
  const hasMetal = !nameShapeHint || hintIsMetal(nameShapeHint);

  let typeStyle = TYPE_STYLE[type] || TYPE_STYLE.scrap;
  if (nameShapeHint && type === 'scrap') {
    // 힌트가 있으면 힌트가 형태를 설명 — metal 힌트만 공구 묘사 추가
    typeStyle = hasMetal
      ? 'bent but recognizable real tool shape, not abstract geometry'
      : 'recognizable everyday object shape, not a metal chunk, not a cube';
  }

  // 금속 묘사(녹, 강철)는 금속성 힌트일 때만 적용
  const rarityMetal =
    type === 'scrap' && hasMetal
      ? (SCRAP_RARITY_STYLE[rarity] || SCRAP_RARITY_STYLE.common)
      : (RARITY_STYLE[rarity] || RARITY_STYLE.common);

  const enHint = typeof visualEn === 'string' ? visualEn.trim().slice(0, 220) : '';

  const parts = [
    nameShapeHint ? nameShapeHint : null,
    enHint ? enHint : null,
    'SNES era 16-bit pixel art inventory icon',
    'single object centered, large on canvas, thick chunky pixels',
    'high contrast silhouette, readable at tiny size',
    'game item loot sprite, crisp pixel edges, no anti-aliased smear',
    typeStyle,
    rarityMetal,
    'isolated subject, empty void around object, alpha friendly',
  ].filter(Boolean);
  const coreEn = parts.join(', ');

  if (clean) {
    return `${coreEn}, item name flavor (do not render as text): "${clean}"`;
  }
  return coreEn;
}

const PIXEL_NEGATIVE =
  'photograph, photo realistic, 3d render, octane, smooth shading, subsurface scatter, ' +
  'wide establishing shot, tiny subject, panorama, landscape, sky, stars, nebula, galaxy, ' +
  'underwater, ocean, fish, tentacles, anime character, human face, hands, body, ' +
  'text, caption, watermark, logo, signature, QR, HUD, UI frame, speech bubble, ' +
  'motion blur, depth of field bokeh, jpeg artifacts, empty blank canvas, collage, split screen';

function pixelNegativeForPrompt(imgPrompt) {
  const cookware =
    /frying pan|skillet|wok|kettle|cooking pot|cauldron|sandwich press|rice cooker|dutch oven/i.test(
      imgPrompt,
    );
  if (cookware) {
    return `${PIXEL_NEGATIVE}, shapeless cube, featureless box, minecraft block, ore block, isometric cube only, no handle`;
  }
  return PIXEL_NEGATIVE;
}

/* ── PixelLab 이미지 생성 헬퍼 ──────────────────────────── */
async function generatePixelLabImage(name, rarity, type, visualEn) {
  if (!process.env.PIXELLAB_SECRET) return null;

  const imgPrompt = buildPixelLabPrompt(name, rarity, type, visualEn);
  const negative = pixelNegativeForPrompt(imgPrompt);

  try {
    const plRes = await fetch(`${PIXELLAB_BASE_URL}/generate-image-pixflux`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PIXELLAB_SECRET}`,
      },
      body: JSON.stringify({
        description: imgPrompt,
        image_size: { width: 64, height: 64 },
        negative_description: negative,
        text_guidance_scale: 7.25,
        no_background: true,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!plRes.ok) {
      const errText = await plRes.text().catch(() => '');
      console.error('[PixelLab] error:', plRes.status, errText);
      return null;
    }

    const plData = await plRes.json();
    console.log('[PixelLab] response keys:', Object.keys(plData || {}),
      'image keys:', Object.keys(plData?.image || {}));

    const b64 = plData?.image?.base64;
    if (!b64) {
      console.warn('[PixelLab] no base64 in response:', JSON.stringify(plData).slice(0, 300));
      return null;
    }

    const cost = plData?.usage?.usd;
    if (cost) console.log(`[PixelLab] "${name}" (${rarity}) — $${cost.toFixed(5)}`);

    // PixelLab은 raw base64만 반환하므로 data URL 접두사 추가
    return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  } catch (err) {
    console.error('[PixelLab] fetch error:', err.message || err);
    return null;
  }
}

/* ── POST /api/ai/catch ─────────────────────────────────────
   에픽·전설용: Claude + PixelLab (shared_pixel_arts 에는 절대 저장하지 않음 — 유저 catches 만)
   body: { rarity: 'epic' | 'legendary' }
   response: { name, type, emoji, imageUrl? }
──────────────────────────────────────────────────────────── */
router.post('/catch', requireAuth, async (req, res) => {
  const { rarity = 'epic' } = req.body;
  const rarityLabel = RARITY_SCRAP_YARD_KO[rarity] || RARITY_KO[rarity] || '우량(에픽)';

  // ── 1. Claude로 이름/타입/이모지 생성 ──
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    return res.status(503).json({ error: 'AI module not available' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  const anthropic = new Anthropic();

  const namePrompt = `고철·비철 스크랩 야드 게임에서 등급 "${rarityLabel}"인 덩어리를 방금 집었습니다.
(압연·전기로·형강·와이어·베어링·슬래그·비철 등 산업·재활용 느낌의 이름)

아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요.

{
  "name": "이름 (한국어, 20자 이내, 야드·설비·금속 가공 용어를 섞어 독특하게)",
  "type": "scrap",
  "emoji": "이 스크랩·금속 덩어리를 표현하는 이모지 1개 (🔩⚙️🪨 등, 생물·물고기 이모지 금지)",
  "visualEn": "English only, max 22 words: concrete metal prop for pixel sprite (materials shapes only), no people no fish"
}

규칙:
- type은 반드시 문자열 "scrap" 만 (다른 값 금지).
- visualEn: PixelLab용 — 녹·용접·톱니·코일·I빔 등 **보이는 형태**만 영어로. 인물·문장·한국어 금지.
- 이름에 후라이팬·프라이팬·냄비·웍·주전자·밥솥 등 **조리 도구**가 들어가면, visualEn은 반드시 그 도구의 **실제 실루엣**(예: 후라이팬=원형 팬+긴 손잡이, 정육면체 금지)을 영어로 구체적으로 쓸 것.
- 우량·특급: 이름이 무겁고 값나는 재료·설비 잔해 느낌.
- 잡철·선별: 현실적인 야드 스크랩 이름.
- 절대 반복되지 않도록 창의적으로`;

  let name, type, emoji, visualEn = '';
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 220,
      messages: [{ role: 'user', content: namePrompt }],
    });

    const text = (message.content[0]?.text || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    name  = typeof parsed.name  === 'string' ? parsed.name.slice(0, 30)  : null;
    type  = VALID_TYPES.includes(parsed.type) ? parsed.type : 'scrap';
    emoji = typeof parsed.emoji === 'string' ? parsed.emoji.slice(0, 8) : '🔩';
    visualEn =
      typeof parsed.visualEn === 'string' && parsed.visualEn.trim()
        ? parsed.visualEn.trim().slice(0, 220)
        : '';

    if (!name) return res.status(500).json({ error: 'AI returned empty name' });
  } catch (err) {
    console.error('[AI /catch] Claude error:', err.message || err);
    return res.status(500).json({ error: 'AI name generation failed' });
  }

  // ── 2. PixelLab 이미지 생성 (에픽·전설은 캐시 없이 항상 새로 생성) ──
  const imageUrl = await generatePixelLabImage(name, rarity, type, visualEn);

  res.json({ name, type, emoji, imageUrl });
});

/* ── POST /api/ai/image ──────────────────────────────────────
   일반(common)만: PixelLab 완료 후 shared_pixel_arts 저장 (name = `shared:scrapyard:` + 표시용 이름)
   희귀(rare) 티어는 게임에서 제거됨 — 이 API는 rarity=common 만 허용
   body: { name: string, type: string, rarity: 'common' }
   response: { imageUrl, cached, bonusCoins, coins }
──────────────────────────────────────────────────────────── */
const SCAN_BONUS_COINS = 100;

async function grantScanBonus(userId) {
  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { coins: { increment: SCAN_BONUS_COINS } },
      select: { coins: true },
    });
    return { bonusCoins: SCAN_BONUS_COINS, coins: updated.coins };
  } catch (err) {
    console.warn('[AI /image] scan bonus failed (non-fatal):', err.message);
    return { bonusCoins: 0, coins: null };
  }
}

router.post('/image', requireAuth, async (req, res) => {
  const { name, type, rarity } = req.body;

  if (!name || typeof name !== 'string' || name.length > 100) {
    return res.status(400).json({ error: '잘못된 이름입니다.' });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `잘못된 타입: ${type}` });
  }
  if (rarity !== 'common') {
    return res.status(400).json({ error: '이 엔드포인트는 일반(common) 전용입니다.' });
  }

  const cleanName = name.trim();
  const cleanType = VALID_TYPES.includes(type) ? type : 'scrap';
  const cacheKey = sharedScrapyardCacheKey(cleanName);

  // ── 1. 공유 캐시 조회 (이름은 shared:scrapyard: 접두 + 표시용 이름)
  try {
    const cached = await prisma.sharedPixelArt.findUnique({
      where: { name: cacheKey },
      select: { imageData: true },
    });
    if (cached?.imageData) {
      console.log(`[SharedPixelArt] cache hit: "${cacheKey}" (display "${cleanName}")`);
      const bonus = await grantScanBonus(req.user.id);
      return res.json({ imageUrl: cached.imageData, cached: true, ...bonus });
    }
  } catch (dbErr) {
    // 테이블 미생성 or prisma generate 미실행 — PixelLab으로 계속
    console.warn('[SharedPixelArt] cache lookup skipped:', dbErr.message);
  }

  // ── 2. PixelLab — 프롬프트에는 표시용 이름만 사용
  const imageUrl = await generatePixelLabImage(cleanName, rarity, cleanType);
  if (!imageUrl) {
    console.warn(`[AI /image] PixelLab returned null for "${cleanName}" (${rarity})`);
    return res.json({ imageUrl: null, cached: false, bonusCoins: 0, coins: null });
  }

  // ── 3. 공유 캐시 저장 (에픽+ 전용 엔드포인트는 여기를 거치지 않음)
  try {
    await prisma.sharedPixelArt.upsert({
      where:  { name: cacheKey },
      create: { name: cacheKey, imageData: imageUrl, rarity, type: cleanType },
      update: { imageData: imageUrl, rarity, type: cleanType },
    });
    console.log(`[SharedPixelArt] saved: "${cacheKey}" (${rarity})`);
  } catch (dbErr) {
    console.warn('[SharedPixelArt] save skipped (non-fatal):', dbErr.message);
  }

  // ── 4. 스캔 성공 보너스 코인 지급 ──
  const bonus = await grantScanBonus(req.user.id);
  res.json({ imageUrl, cached: false, ...bonus });
});

/* ── GET /api/ai/floaters ────────────────────────────────────
   배경 플로터용: shared_pixel_arts 에서 랜덤 목록 반환
   인증 불필요 (캐시 읽기 전용)
──────────────────────────────────────────────────────────── */
router.get('/floaters', async (req, res) => {
  const limit = Math.min(40, Math.max(1, parseInt(req.query.limit) || 20));
  try {
    const arts = await prisma.sharedPixelArt.findMany({
      take: limit * 6,
      select: { name: true, imageData: true },
      orderBy: { createdAt: 'desc' },
    });
    const filtered = arts.filter((a) => !String(a.name || '').startsWith(SHARED_SCRAPYARD_CACHE_PREFIX));
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
    res.json({ arts: filtered.slice(0, limit) });
  } catch (err) {
    console.warn('[AI /floaters]', err.message);
    res.json({ arts: [] });
  }
});

module.exports = router;
