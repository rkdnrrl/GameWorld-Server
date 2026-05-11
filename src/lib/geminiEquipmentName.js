'use strict';

/** Google AI Studio / Gemini API — Flash-Lite 계열 */
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim();
}

function getGeminiModel() {
  return String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function parseGenerateContentText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

/**
 * 재료 목록으로 장비 이름 한 줄 생성 (한국어).
 * @param {{ resolved: object[], tier: string, signal?: AbortSignal }} opts
 * @returns {Promise<{ name: string | null, reason?: string }>}
 */
async function generateForgeEquipmentNameFromMaterials(opts) {
  const key = getGeminiApiKey();
  if (!key) {
    return { name: null, reason: 'no_api_key' };
  }

  const { resolved, tier } = opts;
  const model = getGeminiModel();
  const lines = (resolved || []).map((r, i) => {
    if (r.kind === 'catch') {
      return `${i + 1}. [낚시 재료] 이름:${JSON.stringify(String(r.itemName || ''))}, 희귀도:${String(r.rarity || 'common')}, 크기:${r.size != null ? r.size : '?'}`;
    }
    return `${i + 1}. [장비 재료] 이름:${JSON.stringify(String(r.name || ''))}, 등급:${String(r.tier || 'common')}`;
  });

  const prompt = `당신은 한국어 SF·우주 낚시 톤의 대장간 작명가입니다. 아래 재료를 섞어 새 장비를 제련했을 때 붙일 이름을 하나만 출력하세요.

규칙:
- 출력은 장비 이름 텍스트 한 줄만 (따옴표·가번호·설명·접두어 금지).
- 최대 30자, 자연스러운 한국어.
- 느낌에 맞는 희귀도 톤: ${String(tier || 'common')}
재료:
${lines.join('\n')}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.88,
          maxOutputTokens: 96,
          topP: 0.95,
        },
      }),
      signal: opts.signal,
    });
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'timeout' : 'network';
    return { name: null, reason: msg };
  }

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    return { name: null, reason: `http_${res.status}`, detail: body.slice(0, 400) };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return { name: null, reason: 'bad_json' };
  }

  const block = json?.promptFeedback?.blockReason;
  if (block) {
    return { name: null, reason: `blocked:${block}` };
  }

  let raw = parseGenerateContentText(json);
  raw = raw.replace(/^[\s"'「『]+|[」』"'.\s]+$/g, '');
  const oneLine = raw.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  const cleaned = oneLine.replace(/^[-*•\d.)]+\s*/, '').slice(0, 120).trim();
  if (!cleaned) {
    return { name: null, reason: 'empty_output' };
  }
  return { name: cleaned };
}

module.exports = {
  generateForgeEquipmentNameFromMaterials,
  getGeminiApiKey,
  getGeminiModel,
  DEFAULT_MODEL,
};
