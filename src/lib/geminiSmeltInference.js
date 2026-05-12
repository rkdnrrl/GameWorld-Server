'use strict';

const { inferSmeltProductFromMaterialName, ALLOWED_IDS, SMELT_CATALOG } = require('./smeltProduct');
const { getGeminiApiKey, getGeminiModel } = require('./geminiEquipmentName');

function fallbackProducts(names) {
  return (names || []).map((n) => inferSmeltProductFromMaterialName(n).id);
}

function parseGenerateContentText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

function normalizeProductId(x) {
  const id = String(x || '').trim().toLowerCase();
  return ALLOWED_IDS.has(id) ? id : 'slag';
}

/**
 * 장비 이름들 -> 용광로 산출물 ID 배열.
 * Gemini가 실패하면 재료명 규칙 기반 추론으로 폴백.
 * @param {string[]} names
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<string[]>}
 */
async function inferSmeltProductsFromEquipmentNames(names, opts = {}) {
  const src = Array.isArray(names) ? names.map((x) => String(x || '')) : [];
  if (src.length === 0) return [];

  const key = getGeminiApiKey();
  if (!key) return fallbackProducts(src);

  const model = getGeminiModel();
  const lines = src.map((n, i) => `${i + 1}. ${JSON.stringify(n)}`).join('\n');
  const allowed = [...ALLOWED_IDS].join(', ');
  const catalogGuide = SMELT_CATALOG
    .map((x) => `- ${x.id} (${x.name}) keywords: ${x.keywords.join(', ')}`)
    .join('\n');
  const prompt = `당신은 게임 대장간의 용광로 분해 감정사입니다.
아래 장비 이름 각각을 녹였을 때 나올 법한 산출물 productId 1개를 고르세요.

**이름 힌트 (반드시 참고)**  
- 키보드·마우스·게임패드·모니터·PC부품·USB·충전기·헤드셋 등 **전자기기** → circuit, silicon, wafer, battery, plastic, glass 중 가장 어울리는 것 (기본은 **circuit**).  
- 티셔츠·바지·모자·신발·패딩 등 **천·섬유** → **textile** (또는 plastic, rubber).  
- **가죽·스웨이드·합피·가죽장갑** 등 → **leather**.  
- **나무·목재·원목·대나무** → **resin**.  
- **도자기·자기** → **ceramic**.  
- 은·금 장식이 이름에 **분명히** 드러나면 silver / gold (이름 속 '녹은·검은' 같은 **은** 자만으로는 silver 금지).  
- 맨 철제 무기·강철 느낌만 강하면 iron.

허용 productId: ${allowed}
산출물 가이드:
${catalogGuide}

규칙:
- 입력 항목 개수와 동일한 길이의 productIds 배열만 반환
- 각 원소는 허용 productId 중 하나
- 애매하면 slag

장비 목록:
${lines}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 180,
      topP: 0.9,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          productIds: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['productIds'],
      },
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch {
    return fallbackProducts(src);
  }
  if (!res.ok) return fallbackProducts(src);

  let json;
  try {
    json = await res.json();
  } catch {
    return fallbackProducts(src);
  }
  const block = json?.promptFeedback?.blockReason;
  if (block) return fallbackProducts(src);

  let parsed = null;
  const text = parseGenerateContentText(json);
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || !Array.isArray(parsed.productIds)) return fallbackProducts(src);

  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    out.push(normalizeProductId(parsed.productIds[i]));
  }
  return out;
}

module.exports = {
  inferSmeltProductsFromEquipmentNames,
};
