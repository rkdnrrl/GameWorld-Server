'use strict';

const {
  getGeminiApiKey,
  getGeminiModel,
  getGeminiFallbackModelId,
  DEFAULT_FALLBACK_MODEL,
} = require('./geminiEquipmentName');
const { normalizeElementSymbol, isValidElementSymbol } = require('./periodicElementSymbols');

const DEFAULT_MODEL_FALLBACK = DEFAULT_FALLBACK_MODEL;

function parseGenerateContentText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

const COMPOSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    compoundNameKo: {
      type: 'STRING',
      description: 'Korean fantasy alchemy product name (2–24 chars), not a real drug brand',
    },
    itemEmoji: { type: 'STRING', description: 'Single emoji for inventory' },
    rarity: { type: 'STRING', description: 'Exactly one of: common, epic, legendary' },
    rationaleKo: { type: 'STRING', description: 'One Korean sentence: how these elements became this' },
    formulaStyleKo: { type: 'STRING', description: 'Optional short e.g. Fe+O 연상' },
  },
  required: ['compoundNameKo', 'rarity', 'rationaleKo'],
};

/**
 * 가마솥에 넣은 주기율표 원소들로부터 **하나의** 연금술 산출물 이름·희귀도를 제안한다.
 * @param {{ name: string, symbol: string, qty: number }[]} slots — 검증된 기호·수량
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ compoundNameKo: string, itemEmoji: string, rarity: string, rationaleKo: string, formulaStyleKo?: string } | null | { reason: string }>}
 */
async function composeElementsToCompound(slots, opts = {}) {
  const key = getGeminiApiKey();
  if (!key) return null;

  const clean = (slots || [])
    .map((s) => ({
      name: String(s && s.name != null ? s.name : '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 120),
      symbol: normalizeElementSymbol(s && s.symbol),
      qty: Math.max(1, Math.floor(Number(s && s.qty)) || 1),
    }))
    .filter((s) => s.name && s.symbol && isValidElementSymbol(s.symbol))
    .slice(0, 16);

  if (clean.length < 2) return { reason: 'need_two_elements' };

  const model = getGeminiModel();
  const fallbackId = getGeminiFallbackModelId(model) || DEFAULT_MODEL_FALLBACK;

  const lines = clean.map((s, i) => `${i + 1}. ${JSON.stringify(s.name)} — 기호 ${s.symbol} ×${s.qty}`);

  const prompt = `당신은 게임 **연금술 조합기**입니다. 아래는 가마솥에 넣은 **실제 주기율표 원소**(IUPAC 기호)와 한 줄 표시 이름·개수입니다.

작업:
1. 이 원소들이 게임 세계에서 **합쳐져 만들어질 법한** 하나의 산출물을 **한국어 이름**으로 지으세요 (화합물·합금·결정·가루·액체·에너지 덩어리 등 판타지 톤).
2. 이름은 **2~24자** 내외, 실존 의약품·상표 그대로·저작권 캐릭터명은 피하세요.
3. 희귀도 rarity는 입력이 희귀할수록 epic/legendary를 고려하되, 과도하면 안 됩니다. 반드시 **common**, **epic**, **legendary** 중 하나만.
4. itemEmoji는 **이모지 한 글자** (없으면 ⚗).
5. rationaleKo는 한 문장으로 왜 이렇게 합쳐졌는지 한국어로.
6. formulaStyleKo는 선택: 짧은 화학 느낌 한 줄 (한국어+기호 섞여도 됨).

가마솥 슬롯:
${lines.join('\n')}

반드시 JSON 한 덩어리만: { "compoundNameKo": "…", "itemEmoji": "⚗", "rarity": "common", "rationaleKo": "…", "formulaStyleKo": "…" }`;

  const url = (modelId) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`;

  const genCfg = {
    temperature: 0.65,
    maxOutputTokens: 768,
    topP: 0.92,
    responseMimeType: 'application/json',
  };

  const bodyStructured = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { ...genCfg, responseSchema: COMPOSE_SCHEMA },
  };

  const bodyPlain = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\n예: {"compoundNameKo":"녹슨 산화 가루","itemEmoji":"🟤","rarity":"common","rationaleKo":"철과 산소가 만나 산화물 연상.","formulaStyleKo":"Fe+O"}`,
          },
        ],
      },
    ],
    generationConfig: { ...genCfg },
  };

  const post = async (modelId, body) =>
    fetch(url(modelId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

  let res;
  try {
    res = await post(model, bodyStructured);
    if (!res.ok && (res.status === 400 || res.status === 404)) {
      res = await post(model, bodyPlain);
    }
    if (!res.ok && fallbackId && fallbackId !== model) {
      const r2 = await post(fallbackId, bodyPlain);
      if (r2.ok) res = r2;
    }
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'timeout' : 'network';
    return { reason: msg };
  }

  if (!res.ok) {
    return { reason: `http_${res.status}` };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return { reason: 'bad_json' };
  }

  if (json?.promptFeedback?.blockReason) {
    return { reason: `blocked:${json.promptFeedback.blockReason}` };
  }

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

  if (!parsed || typeof parsed !== 'object') {
    return { reason: 'bad_json' };
  }

  let compoundNameKo =
    typeof parsed.compoundNameKo === 'string' ? parsed.compoundNameKo.trim().replace(/\s+/g, ' ') : '';
  compoundNameKo = compoundNameKo.slice(0, 50);
  if (compoundNameKo.length < 2) {
    return { reason: 'empty_name' };
  }

  const rarityRaw = String(parsed.rarity || 'common').toLowerCase();
  const rarity = ['common', 'epic', 'legendary'].includes(rarityRaw) ? rarityRaw : 'common';

  let itemEmoji =
    typeof parsed.itemEmoji === 'string' && parsed.itemEmoji.trim() ? parsed.itemEmoji.trim().slice(0, 10) : '⚗️';

  const rationaleKo =
    typeof parsed.rationaleKo === 'string' && parsed.rationaleKo.trim()
      ? parsed.rationaleKo.trim().slice(0, 220)
      : '';

  const formulaStyleKo =
    typeof parsed.formulaStyleKo === 'string' && parsed.formulaStyleKo.trim()
      ? parsed.formulaStyleKo.trim().slice(0, 80)
      : '';

  if (!rationaleKo) {
    return { reason: 'empty_rationale' };
  }

  return { compoundNameKo, itemEmoji, rarity, rationaleKo, formulaStyleKo: formulaStyleKo || undefined };
}

module.exports = { composeElementsToCompound };
