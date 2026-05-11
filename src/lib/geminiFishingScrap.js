'use strict';

const { getGeminiApiKey, getGeminiModel } = require('./geminiEquipmentName');

function parseGenerateContentText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

const FISHING_SCRAP_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: {
      type: 'STRING',
      description: 'Korean scrap yard metal junk name, max 20 chars, industrial tone',
    },
    emoji: {
      type: 'STRING',
      description: 'Single emoji for scrap metal (no fish, no ocean)',
    },
    visualEn: {
      type: 'STRING',
      description:
        'English only, max 22 words: concrete metal prop for pixel sprite, shapes only, no people no fish',
    },
  },
  required: ['name'],
};

/**
 * 일반(common) 고철 스크랩 — 이름·이모지·PixelLab용 영어 힌트 (Gemini).
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ name: string, emoji: string, visualEn: string } | null>}
 */
async function generateFishingScrapNameBundle(opts = {}) {
  const key = getGeminiApiKey();
  if (!key) return null;

  const model = getGeminiModel();
  const prompt = `당신은 우주 낚시·고철 야드 톤 게임의 작명가입니다.
방금 플레이어가 "일반(common)" 등급의 스크랩 덩어리를 집었습니다.

아래 JSON만 출력하세요.

이름(name):
- 한국어, **20자 이내**
- 야드·설비·금속·재활용 잔해 느낌 (압연, 형강, 와이어, 베어링, 슬래그, 비철 등)
- 너무 길게 설명하지 말 것

emoji:
- 스크랩·금속을 나타내는 이모지 **1개** (🔩⚙️🪨 등). 물고기·바다·생물 이모지 금지.

visualEn:
- PixelLab용 **영어만**, 최대 22단어
- 녹·용접·톱니·코일·I빔 등 **보이는 형태**만. 사람·문장·한국어 금지.

조리 도구 이름이 나오면 visualEn은 그 도구의 **실제 실루엣**(예: 후라이팬=원형 팬+긴 손잡이)을 영어로 구체적으로 쓸 것.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const bodyStructured = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.88,
      maxOutputTokens: 220,
      topP: 0.94,
      responseMimeType: 'application/json',
      responseSchema: FISHING_SCRAP_RESPONSE_SCHEMA,
    },
  };

  const bodyPlainJson = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\n응답은 반드시 JSON 한 덩어리만: {"name":"","emoji":"🔩","visualEn":"bent corroded steel scrap chunk"}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.88,
      maxOutputTokens: 220,
      topP: 0.94,
      responseMimeType: 'application/json',
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyStructured),
      signal: opts.signal,
    });
    if (!res.ok && (res.status === 400 || res.status === 404)) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPlainJson),
        signal: opts.signal,
      });
    }
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let json;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  if (json?.promptFeedback?.blockReason) return null;

  let rawText = parseGenerateContentText(json);
  if (!rawText && json?.candidates?.[0]?.content?.parts?.[0]?.text != null) {
    rawText = String(json.candidates[0].content.parts[0].text || '');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  let name = String(parsed.name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 30);
  if (!name) return null;

  let emoji = typeof parsed.emoji === 'string' ? parsed.emoji.trim().slice(0, 8) : '';
  if (!emoji) emoji = '🔩';

  const visualEn =
    typeof parsed.visualEn === 'string' && parsed.visualEn.trim()
      ? parsed.visualEn.trim().slice(0, 220)
      : '';

  return { name, emoji, visualEn };
}

module.exports = { generateFishingScrapNameBundle };
