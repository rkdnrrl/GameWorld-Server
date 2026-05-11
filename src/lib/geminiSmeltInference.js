'use strict';

const { inferSmeltProductFromMaterialName, ALLOWED_IDS } = require('./smeltProduct');
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
  const prompt = `당신은 게임 대장간의 용광로 분해 감정사입니다.
아래 장비 이름 각각을 분해했을 때 가장 그럴듯한 산출물 1개를 고르세요.
허용 productId: ${allowed}

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
