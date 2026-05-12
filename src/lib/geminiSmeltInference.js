'use strict';

const {
  inferSmeltProductsFromMaterialName,
  ALLOWED_IDS,
  SMELT_CATALOG,
} = require('./smeltProduct');
const { getGeminiApiKey, getGeminiModel } = require('./geminiEquipmentName');

function fallbackProductYields(names) {
  return (names || []).map((n) => inferSmeltProductsFromMaterialName(n));
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

function normalizeYieldRow(row, fallbackName) {
  const arr = Array.isArray(row) ? row : [];
  const normed = [];
  const seen = new Set();
  for (const x of arr) {
    const id = normalizeProductId(x);
    if (seen.has(id)) continue;
    seen.add(id);
    normed.push(id);
    if (normed.length >= 3) break;
  }
  if (normed.length > 0) return normed;
  return inferSmeltProductsFromMaterialName(fallbackName);
}

/**
 * 장비 이름들 -> 녹일 때마다 산출물 productId 배열(각 1~3개).
 * Gemini가 실패하면 규칙 기반 inferSmeltProductsFromMaterialName.
 * @param {string[]} names
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<string[][]>}
 */
async function inferSmeltProductsFromEquipmentNames(names, opts = {}) {
  const src = Array.isArray(names) ? names.map((x) => String(x || '')) : [];
  if (src.length === 0) return [];

  const key = getGeminiApiKey();
  if (!key) return fallbackProductYields(src);

  const model = getGeminiModel();
  const lines = src.map((n, i) => `${i + 1}. ${JSON.stringify(n)}`).join('\n');
  const allowed = [...ALLOWED_IDS].join(', ');
  const catalogGuide = SMELT_CATALOG
    .map((x) => `- ${x.id} (${x.name}) keywords: ${x.keywords.join(', ')}`)
    .join('\n');
  const prompt = `당신은 게임 대장간의 용광로 분해 감정사입니다.
아래 장비 이름 **각각**을 녹였을 때 나올 법한 산출물 productId를 **1~3개** 고르세요. 한 덩어리를 녹이면 주성분 외에 부산물·잔재가 같이 나올 수 있습니다.

**이름 힌트 (반드시 참고)**  
- 키보드·마우스·게임패드·모니터·PC부품·USB·충전기·헤드셋 등 **전자기기** → circuit, silicon, wafer, battery, plastic, glass 등 **여러 개** 조합 가능 (예: circuit + plastic).  
- 티셔츠·바지·모자·신발·패딩 등 **천·섬유** → textile (+ plastic 등).  
- **가죽·스웨이드·합피·가죽장갑** 등 → leather (+ rubber 등).  
- **나무·목재·원목·대나무** → resin.  
- **도자기·자기** → ceramic.  
- 은·금 장식이 이름에 **분명히** 드러나면 silver / gold를 다른 산출물과 함께. ('녹은·검은' 같은 **은** 자만으로는 silver 금지).  
- 맨 철제 무기·강철 느낌만 강하면 iron (+ slag 가능).

허용 productId: ${allowed}
산출물 가이드:
${catalogGuide}

규칙:
- productYields는 **입력 장비 개수와 같은 길이**의 배열.
- productYields[i]는 i번째 장비 이름에 대응하는 **문자열 배열**(길이 1~3), 각 원소는 허용 productId.
- 애매한 부분은 slag로.
- 한 줄에 하나의 장비만 대응; 순서를 바꾸지 말 것.

장비 목록:
${lines}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.45,
      maxOutputTokens: 512,
      topP: 0.9,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          productYields: {
            type: 'ARRAY',
            description: 'Per equipment name: 1-3 product ids',
            items: {
              type: 'ARRAY',
              items: { type: 'STRING' },
            },
          },
        },
        required: ['productYields'],
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
    return fallbackProductYields(src);
  }
  if (!res.ok) return fallbackProductYields(src);

  let json;
  try {
    json = await res.json();
  } catch {
    return fallbackProductYields(src);
  }
  const block = json?.promptFeedback?.blockReason;
  if (block) return fallbackProductYields(src);

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
  if (!parsed) return fallbackProductYields(src);

  if (Array.isArray(parsed.productYields) && parsed.productYields.length === src.length) {
    return src.map((name, i) => normalizeYieldRow(parsed.productYields[i], name));
  }

  if (Array.isArray(parsed.productIds) && parsed.productIds.length === src.length) {
    return src.map((name, i) => normalizeYieldRow([parsed.productIds[i]], name));
  }

  return fallbackProductYields(src);
}

module.exports = {
  inferSmeltProductsFromEquipmentNames,
};
