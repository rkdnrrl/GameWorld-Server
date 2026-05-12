'use strict';

const {
  getGeminiApiKey,
  getGeminiModel,
  getGeminiFallbackModelId,
  DEFAULT_FALLBACK_MODEL,
} = require('./geminiEquipmentName');
const { normalizeElementSymbol, isValidElementSymbol, getAtomicNumberForSymbol } = require('./periodicElementSymbols');

const DEFAULT_MODEL_FALLBACK = DEFAULT_FALLBACK_MODEL;

function parseGenerateContentText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

const DECOMPOSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    elements: {
      type: 'ARRAY',
      description:
        'Only real periodic-table elements; plausible from given fantasy/material names; merge duplicates in output',
      items: {
        type: 'OBJECT',
        properties: {
          symbol: {
            type: 'STRING',
            description: 'IUPAC element symbol e.g. Fe, O, Na',
          },
          nameKo: {
            type: 'STRING',
            description: 'Korean element name e.g. 철, 산소',
          },
          atomicNumber: { type: 'INTEGER', description: '1-118 if known' },
          rationaleKo: {
            type: 'STRING',
            description: 'Short Korean: why this element from those names',
          },
        },
        required: ['symbol'],
      },
    },
  },
  required: ['elements'],
};

/**
 * 재료 이름들을 바탕으로 주기율표 원소 목록을 Gemini에 요청한다.
 * @param {string[]} names
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ elements: { symbol: string, nameKo?: string, atomicNumber?: number, rationaleKo?: string }[], reason?: string } | null>}
 */
async function decomposeMaterialNamesToElements(names, opts = {}) {
  const key = getGeminiApiKey();
  if (!key) return null;

  const clean = [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 20);
  if (clean.length === 0) return { elements: [], reason: 'empty_names' };

  const model = getGeminiModel();
  const fallbackId = getGeminiFallbackModelId(model) || DEFAULT_MODEL_FALLBACK;

  const prompt = `당신은 연금술·게임 세계의 **분해 분석기**입니다. 아래는 가마솥에 넣은 **재료·사물·장비의 한국어 이름** 목록입니다.

작업:
1. 각 이름의 재질·연상·비유를 고려해, **실제 화학 주기율표(IUPAC)에 존재하는 원소**만 골라 목록으로 제시하세요.
2. 상상 속 허구 원소·합금 상표명(예: "비브라늄")은 **넣지 마세요**. 반드시 1번(H)부터 118번(Og)까지 검증 가능한 기호만 사용하세요.
3. 이름이 추상적이어도 **합리적으로 연결되는** 원소를 고를 수 있으면 포함합니다. 전혀 연결할 수 없으면 생략합니다.
4. 같은 기호는 한 번만 (원자번호·한글명은 정확히).
5. rationaleKo는 한 문장으로, 왜 이 원소가 나왔는지 한국어로 짧게.

재료 이름 목록:
${clean.map((n, i) => `${i + 1}. ${JSON.stringify(n)}`).join('\n')}

반드시 JSON 한 덩어리만: { "elements": [ { "symbol": "Fe", "nameKo": "철", "atomicNumber": 26, "rationaleKo": "…" } ] }`;

  const url = (modelId) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`;

  const genCfg = {
    temperature: 0.55,
    maxOutputTokens: 1024,
    topP: 0.9,
    responseMimeType: 'application/json',
  };

  const bodyStructured = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { ...genCfg, responseSchema: DECOMPOSE_SCHEMA },
  };

  const bodyPlain = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\n예: {"elements":[{"symbol":"C","nameKo":"탄소","atomicNumber":6,"rationaleKo":"유기물 연상"}]}`,
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
    return { elements: [], reason: msg };
  }

  if (!res.ok) {
    return { elements: [], reason: `http_${res.status}` };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return { elements: [], reason: 'bad_json' };
  }

  if (json?.promptFeedback?.blockReason) {
    return { elements: [], reason: `blocked:${json.promptFeedback.blockReason}` };
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

  const arr = parsed && Array.isArray(parsed.elements) ? parsed.elements : [];
  const bySymbol = new Map();

  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const sym = normalizeElementSymbol(row.symbol);
    if (!sym || !isValidElementSymbol(sym)) continue;
    const nameKo =
      typeof row.nameKo === 'string' && row.nameKo.trim() ? row.nameKo.trim().slice(0, 24) : '';
    let z = Number(row.atomicNumber);
    if (!Number.isFinite(z) || z < 1 || z > 118) z = undefined;
    if (z == null) z = getAtomicNumberForSymbol(sym);
    const rationaleKo =
      typeof row.rationaleKo === 'string' && row.rationaleKo.trim()
        ? row.rationaleKo.trim().slice(0, 200)
        : '';

    if (!bySymbol.has(sym)) {
      bySymbol.set(sym, { symbol: sym, nameKo, atomicNumber: z, rationaleKo });
    }
  }

  const elements = [...bySymbol.values()].sort((a, b) => {
    const za = a.atomicNumber != null ? a.atomicNumber : 999;
    const zb = b.atomicNumber != null ? b.atomicNumber : 999;
    if (za !== zb) return za - zb;
    return a.symbol.localeCompare(b.symbol);
  });

  return { elements };
}

module.exports = { decomposeMaterialNamesToElements };
