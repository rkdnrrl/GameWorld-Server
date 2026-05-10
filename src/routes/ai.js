const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const RARITY_KO = {
  common: '일반',
  rare: '희귀',
  epic: '에픽',
  legendary: '전설',
};

const VALID_TYPES = ['fish', 'creature', 'artifact', 'crystal', 'debris'];

/* ── POST /api/ai/catch ─────────────────────────────────────
   body: { rarity: 'common' | 'rare' | 'epic' | 'legendary' }
   response: { name, type, emoji }
──────────────────────────────────────────────────────────── */
router.post('/catch', requireAuth, async (req, res) => {
  const { rarity = 'common' } = req.body;
  const rarityLabel = RARITY_KO[rarity] || '일반';

  // Anthropic SDK를 동적으로 로드 (설치 안 된 경우 폴백)
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    return res.status(503).json({ error: 'AI module not available' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  const client = new Anthropic();

  const prompt = `우주 낚시 게임에서 희귀도 "${rarityLabel}"인 생명체/유물을 방금 잡았습니다.
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

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (message.content[0]?.text || '').trim();

    // JSON 파싱
    let parsed;
    try {
      // 혹시 ```json ... ``` 형태로 응답하면 추출
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return res.status(500).json({ error: 'AI response parse failed' });
    }

    const name = typeof parsed.name === 'string' ? parsed.name.slice(0, 30) : null;
    const type = VALID_TYPES.includes(parsed.type) ? parsed.type : 'creature';
    const emoji = typeof parsed.emoji === 'string' ? parsed.emoji.slice(0, 8) : '❓';

    if (!name) return res.status(500).json({ error: 'AI returned empty name' });

    res.json({ name, type, emoji });
  } catch (err) {
    console.error('[AI /catch]', err.message || err);
    res.status(500).json({ error: 'AI generation failed' });
  }
});

module.exports = router;
