const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const RARITY_KO = {
  common:    '일반',
  rare:      '희귀',
  epic:      '에픽',
  legendary: '전설',
};

const VALID_TYPES = ['fish', 'creature', 'artifact', 'crystal', 'debris'];

const PIXELLAB_BASE_URL = 'https://api.pixellab.ai/v1';

/* ── POST /api/ai/catch ─────────────────────────────────────
   body: { rarity: 'common' | 'rare' | 'epic' | 'legendary' }
   response: { name, type, emoji, imageUrl? }
──────────────────────────────────────────────────────────── */
router.post('/catch', requireAuth, async (req, res) => {
  const { rarity = 'common' } = req.body;
  const rarityLabel = RARITY_KO[rarity] || '일반';

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
- 일반: 평범한 우주 생물이나 잔해
- 희귀: 특이한 형태나 신기한 특성
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

  // ── 2. PixelLab Pixflux 로 픽셀아트 생성 ──
  let imageUrl = null;
  if (process.env.PIXELLAB_SECRET) {
    try {
      const rarityStyle = {
        rare:      'rare space creature, blue and purple cosmic tones, glowing aura',
        epic:      'epic space entity, red and gold fiery tones, intense cosmic glow',
        legendary: 'supreme legendary cosmic being, golden divine radiance, awe-inspiring',
      }[rarity] || 'colorful space creature';

      const imgPrompt =
        `${name}, ${rarityStyle}, ` +
        `retro 16-bit pixel art game sprite, centered, simple clean design, ` +
        `dark space background, game icon style, no text`;

      const plRes = await fetch(`${PIXELLAB_BASE_URL}/generate-image-pixflux`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PIXELLAB_SECRET}`,
        },
        body: JSON.stringify({
          description: imgPrompt,
          image_size: { width: 64, height: 64 },
          negative_description: 'text, words, letters, watermark, blurry, human face, realistic',
          text_guidance_scale: 8.0,
          no_background: false,
        }),
        signal: AbortSignal.timeout(15000), // 15초 타임아웃
      });

      if (plRes.ok) {
        const plData = await plRes.json();
        const b64 = plData?.image?.base64;
        if (b64) {
          imageUrl = b64; // 이미 "data:image/png;base64,..." 형식
          const cost = plData?.usage?.usd;
          if (cost) console.log(`[PixelLab] ${name} (${rarity}) — $${cost.toFixed(5)}`);
        }
      } else {
        const errText = await plRes.text().catch(() => '');
        console.error('[AI /catch] PixelLab error:', plRes.status, errText);
      }
    } catch (err) {
      console.error('[AI /catch] PixelLab error:', err.message || err);
      // 이미지 실패해도 이름은 정상 반환
    }
  }

  res.json({ name, type, emoji, imageUrl });
});

module.exports = router;
