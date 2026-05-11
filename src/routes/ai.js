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

const VALID_TYPES = ['fish', 'creature', 'artifact', 'crystal', 'debris', 'cosmic'];

const PIXELLAB_BASE_URL = 'https://api.pixellab.ai/v1';

const RARITY_STYLE = {
  common:    'colorful space creature or debris, simple cosmic design',
  rare:      'rare space creature, blue and purple cosmic tones, glowing aura',
  epic:      'epic space entity, red and gold fiery tones, intense cosmic glow',
  legendary: 'supreme legendary cosmic being, golden divine radiance, awe-inspiring',
};

/* ── PixelLab 이미지 생성 헬퍼 ──────────────────────────── */
async function generatePixelLabImage(name, rarity) {
  if (!process.env.PIXELLAB_SECRET) return null;

  const rarityStyle = RARITY_STYLE[rarity] || 'colorful space creature';
  const imgPrompt =
    `${name}, ${rarityStyle}, ` +
    `retro 16-bit pixel art game sprite, centered, simple clean design, ` +
    `dark space background, game icon style, no text`;

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
        negative_description: 'text, words, letters, watermark, blurry, human face, realistic',
        text_guidance_scale: 8.0,
        no_background: false,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!plRes.ok) {
      const errText = await plRes.text().catch(() => '');
      console.error('[PixelLab] error:', plRes.status, errText);
      return null;
    }

    const plData = await plRes.json();
    const b64 = plData?.image?.base64;
    if (!b64) return null;

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
   에픽·전설용: Claude로 이름/타입/이모지 생성 + PixelLab 이미지 (캐시 없음)
   body: { rarity: 'epic' | 'legendary' }
   response: { name, type, emoji, imageUrl? }
──────────────────────────────────────────────────────────── */
router.post('/catch', requireAuth, async (req, res) => {
  const { rarity = 'epic' } = req.body;
  const rarityLabel = RARITY_KO[rarity] || '에픽';

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

  const namePrompt = `우주 낚시 게임에서 희귀도 "${rarityLabel}"인 생명체/유물을 방금 잡았습니다.
아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요.

{
  "name": "이름 (한국어, 20자 이내, 우주적이고 독특하게)",
  "type": "fish 또는 creature 또는 artifact 또는 crystal 또는 debris 중 하나",
  "emoji": "이 생명체/유물을 표현하는 이모지 1개"
}

규칙:
- 에픽: 강렬하고 신비로운 존재
- 전설: 전설적이고 압도적인 존재, 이름부터 웅장해야 함
- 절대 반복되지 않도록 창의적으로`;

  let name, type, emoji;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: namePrompt }],
    });

    const text = (message.content[0]?.text || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    name  = typeof parsed.name  === 'string' ? parsed.name.slice(0, 30)  : null;
    type  = VALID_TYPES.includes(parsed.type) ? parsed.type : 'creature';
    emoji = typeof parsed.emoji === 'string' ? parsed.emoji.slice(0, 8) : '❓';

    if (!name) return res.status(500).json({ error: 'AI returned empty name' });
  } catch (err) {
    console.error('[AI /catch] Claude error:', err.message || err);
    return res.status(500).json({ error: 'AI name generation failed' });
  }

  // ── 2. PixelLab 이미지 생성 (에픽·전설은 캐시 없이 항상 새로 생성) ──
  const imageUrl = await generatePixelLabImage(name, rarity);

  res.json({ name, type, emoji, imageUrl });
});

/* ── POST /api/ai/image ──────────────────────────────────────
   일반·희귀용: 이름 기반으로 공유 캐시 확인 → 없으면 PixelLab 생성 후 저장
   body: { name: string, type: string, rarity: 'common' | 'rare' }
   response: { imageUrl: string | null, cached: boolean }
──────────────────────────────────────────────────────────── */
router.post('/image', requireAuth, async (req, res) => {
  const { name, type, rarity } = req.body;

  if (!name || typeof name !== 'string' || name.length > 100) {
    return res.status(400).json({ error: '잘못된 이름입니다.' });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `잘못된 타입: ${type}` });
  }
  if (rarity !== 'common' && rarity !== 'rare') {
    return res.status(400).json({ error: '이 엔드포인트는 일반·희귀용입니다.' });
  }

  const cleanName = name.trim();
  const cleanType = VALID_TYPES.includes(type) ? type : 'creature';

  // ── 1. 공유 캐시 조회 (Prisma 미설정 시 건너뜀) ──
  try {
    const cached = await prisma.sharedPixelArt.findUnique({
      where: { name: cleanName },
      select: { imageData: true },
    });
    if (cached?.imageData) {
      console.log(`[SharedPixelArt] cache hit: "${cleanName}"`);
      return res.json({ imageUrl: cached.imageData, cached: true });
    }
  } catch (dbErr) {
    // 테이블 미생성 or prisma generate 미실행 — PixelLab으로 계속
    console.warn('[SharedPixelArt] cache lookup skipped:', dbErr.message);
  }

  // ── 2. PixelLab으로 이미지 생성 (캐시 실패 여부와 무관하게 항상 시도) ──
  const imageUrl = await generatePixelLabImage(cleanName, rarity);
  if (!imageUrl) {
    console.warn(`[AI /image] PixelLab returned null for "${cleanName}" (${rarity})`);
    return res.json({ imageUrl: null, cached: false });
  }

  // ── 3. 공유 캐시에 저장 (실패해도 이미지는 정상 반환) ──
  try {
    await prisma.sharedPixelArt.upsert({
      where:  { name: cleanName },
      create: { name: cleanName, imageData: imageUrl, rarity, type: cleanType },
      update: { imageData: imageUrl, rarity, type: cleanType },
    });
    console.log(`[SharedPixelArt] saved: "${cleanName}" (${rarity})`);
  } catch (dbErr) {
    console.warn('[SharedPixelArt] save skipped (non-fatal):', dbErr.message);
  }

  res.json({ imageUrl, cached: false });
});

module.exports = router;
