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
      description:
        'Korean everyday object name player recognizes, max 22 chars: PC parts, furniture, clothes, sports, plants, office supplies, appliances — NOT industrial scrap-only names',
    },
    emoji: {
      type: 'STRING',
      description: 'Single emoji matching the object (no fish, no ocean waves)',
    },
    visualEn: {
      type: 'STRING',
      description:
        'English only, max 24 words: concrete real-world object silhouette for pixel icon (plastic, fabric, wood, glass ok); shapes only; no people no fish',
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
  const prompt = `당신은 우주 낚시 게임의 작명가입니다. 플레이어가 우주 잔해에서 "일반(common)" 등급 아이템 하나를 건졌습니다.

**중요 — 이름 톤 (반드시 지킬 것)**  
- 세상에서 실제로 볼 수 있는 **물건·용품·가전·가구·옷·식물** 이름으로 지을 것.  
- **금지**: 압연·형강·와이어코일·슬래그·비철·I빔·베어링·야드 설비처럼 **공장·고철장 전용 용어 위주** 이름. "고철 덩어리" 느낌만 나오면 실패입니다.

**매번 아래 범주 중 하나를 골라 다양하게** (같은 카테고리만 연속으로 내지 말 것):  
- PC·전자: 키보드, 마우스, 게임패드, 모니터, 본체, 노트북, RAM, CPU, GPU, 파워서플라이, SSD, USB메모리, 웹캠, 헤드셋, 멀티탭 등  
- 생활·가구: 책상, 의자, 선풍기, 베개, 이불, 스탠드, 필통, 책, 노트, 램프 등  
- 패션: 모자, 슬리퍼, 운동화, 양말, 장갑, 티셔츠, 후드, 청바지, 반바지 등 (너무 긴 풀네임 대신 짧은 통칭)  
- 악기·취미: 피아노, 기타, 우쿨렐레, 드럼패드 등  
- 운동: 덤벨, 케틀벨, 요가매트, 헬스밴드 등  
- 식물·자연: 잔디, 클로버, 민들레, 장미, 튤립, 소나무, 은행나무 등 (한 단어 또는 짧은 복합어)

이름(name): 한국어 **22자 이내**, 위 범주에 맞는 **익숙한 사물명**. 나열·설명 문장 금지.

emoji: 그 물건에 맞는 이모지 **1개**. 물고기·바다·생물 이모지 금지.

visualEn: PixelLab용 **영어만**, 최대 24단어. **그 물건의 실제 실루엣**(재질: 금속·플라스틱·천·나무 등 자연스럽게). 사람·문장·한국어 금지.

아래 JSON만 출력하세요.`;

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
            text: `${prompt}\n\n응답은 반드시 JSON 한 덩어리만: {"name":"무선 마우스","emoji":"🖱️","visualEn":"wireless computer mouse with two buttons scroll wheel ergonomic plastic body"}`,
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
