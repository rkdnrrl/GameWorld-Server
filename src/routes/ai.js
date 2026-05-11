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

/** PixelLab은 영어 구도·재질 위주가 안정적 — 한국어 이름은 짧은 무드 힌트로만 */
function buildPixelLabPrompt(displayName, rarity, type, visualEn) {
  const clean = String(displayName || '').trim().slice(0, 48);
  const typeStyle = TYPE_STYLE[type] || TYPE_STYLE.scrap;
  const rarityMetal =
    type === 'scrap' ? (SCRAP_RARITY_STYLE[rarity] || SCRAP_RARITY_STYLE.common) : (RARITY_STYLE[rarity] || RARITY_STYLE.common);

  const enHint = typeof visualEn === 'string' ? visualEn.trim().slice(0, 220) : '';

  const parts = [
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
    return `${coreEn}, scrapyard item mood inspired by label: "${clean}"`;
  }
  return coreEn;
}

const PIXEL_NEGATIVE =
  'photograph, photo realistic, 3d render, octane, smooth shading, subsurface scatter, ' +
  'wide establishing shot, tiny subject, panorama, landscape, sky, stars, nebula, galaxy, ' +
  'underwater, ocean, fish, tentacles, anime character, human face, hands, body, ' +
  'text, caption, watermark, logo, signature, QR, HUD, UI frame, speech bubble, ' +
  'motion blur, depth of field bokeh, jpeg artifacts, empty blank canvas, collage, split screen';

/* ── PixelLab 이미지 생성 헬퍼 ──────────────────────────── */
async function generatePixelLabImage(name, rarity, type, visualEn) {
  if (!process.env.PIXELLAB_SECRET) return null;

  const imgPrompt = buildPixelLabPrompt(name, rarity, type, visualEn);

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
        negative_description: PIXEL_NEGATIVE,
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
