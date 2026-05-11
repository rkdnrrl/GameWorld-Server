'use strict';

const { heuristicEquipmentNameFromResolved, hangulOnly } = require('./forgeHeuristicName');

/** Google AI Studio / Gemini API — Flash-Lite 계열 */
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

/** 재료 풀네임 나열·인벤토리 문장 금지 (「○○의 ◇◇검」 같은 서사 이름은 허용) */
function nameViolatesForgeStyle(name, resolved) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (/의\s*무기\s*$/.test(s)) return true;
  // 나열형: "○○ 와 △△ 와 …" 처럼 공백으로 이어 붙인 재료 나열
  if (/\s와\s.+\s와\s/.test(s)) return true;
  if (/\s과\s.+\s과\s/.test(s)) return true;
  if (/·.+·.+/.test(s) && /무기|재료/.test(s)) return true;
  if (/외\s*\d+\s*가지/.test(s)) return true;
  if (/를\s*섞어|을\s*섞어/.test(s)) return true;
  const mats = (resolved || []).map((r) =>
    String(r.kind === 'catch' ? r.itemName : r.name || '').trim(),
  ).filter(Boolean);
  let longHits = 0;
  for (const m of mats) {
    const h = hangulOnly(m);
    if (h.length >= 5 && s.includes(h)) longHits += 1;
  }
  if (longHits >= 2) return true;
  return false;
}

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

/** Gemini REST responseSchema (OBJECT / STRING / INTEGER / NUMBER) */
const FORGE_BUNDLE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: {
      type: 'STRING',
      description:
        'Korean weapon/gear name 10-24 chars preferred; epic poetic titles ok (e.g. 달빛의 선율검, 지옥의 명멸검); no raw material inventory listing',
    },
    attackBonus: { type: 'INTEGER', description: 'Attack bonus integer' },
    defenseBonus: { type: 'INTEGER', description: 'Defense bonus integer' },
    speedBonus: { type: 'NUMBER', description: 'Speed multiplier 0.02–0.20 (e.g. 0.08)' },
    durabilityMax: { type: 'INTEGER', description: 'Max durability points' },
    durability: { type: 'INTEGER', description: 'Current durability; new craft equals max' },
    nameClass: {
      type: 'STRING',
      description: 'Name quality class: signature | ordinary',
    },
  },
  required: ['name', 'attackBonus', 'defenseBonus', 'speedBonus', 'durabilityMax', 'durability'],
};

function tierCaps(tier) {
  const t = String(tier || 'common').toLowerCase();
  if (t === 'legendary') return { atk: 72, def: 58, spdHi: 0.22, durHi: 280, durLo: 80 };
  if (t === 'epic') return { atk: 56, def: 45, spdHi: 0.2, durHi: 220, durLo: 65 };
  if (t === 'rare') return { atk: 42, def: 34, spdHi: 0.18, durHi: 170, durLo: 50 };
  return { atk: 30, def: 24, spdHi: 0.16, durHi: 130, durLo: 35 };
}

/**
 * 모델 출력을 재료 티어 기준으로 클램프 (이름 톤과 맞게 상한만).
 * @param {object} raw
 * @param {string} tier
 * @param {{ avgSourceSize?: number|null, maxSourceSize?: number|null }} [sizeExtra]
 */
function normalizeGeminiForgeStats(raw, tier, sizeExtra) {
  const c = tierCaps(tier);
  const clampInt = (n, lo, hi) => {
    const x = Math.round(Number(n));
    if (!Number.isFinite(x)) return lo;
    return Math.min(hi, Math.max(lo, x));
  };
  const attackBonus = clampInt(raw.attackBonus, 1, c.atk);
  const defenseBonus = clampInt(raw.defenseBonus, 1, c.def);
  let spd = Number(raw.speedBonus);
  if (!Number.isFinite(spd)) spd = 0.04;
  spd = Math.min(c.spdHi, Math.max(0.01, Number(spd.toFixed(3))));
  let durabilityMax = clampInt(raw.durabilityMax, c.durLo, c.durHi);
  let durability = clampInt(raw.durability, 1, durabilityMax);
  if (durability > durabilityMax) durability = durabilityMax;
  if (durability < durabilityMax * 0.5) durability = durabilityMax;
  return {
    attackBonus,
    defenseBonus,
    speedBonus: spd,
    durabilityMax,
    durability,
    avgSourceSize: sizeExtra && sizeExtra.avgSourceSize != null ? sizeExtra.avgSourceSize : null,
    maxSourceSize: sizeExtra && sizeExtra.maxSourceSize != null ? sizeExtra.maxSourceSize : null,
  };
}

/**
 * 재료 목록으로 장비 이름만 (레거시·폴백).
 */
async function generateForgeEquipmentNameFromMaterials(opts) {
  const bundle = await generateForgeEquipmentBundleFromMaterials(opts);
  if (!bundle || !bundle.name) return { name: null, reason: bundle?.reason || 'empty' };
  return { name: bundle.name, reason: bundle.reason };
}

/**
 * 이름 + 능력치 + 내구도를 한 번에 (이름에 어울리게 설계).
 * @param {{ resolved: object[], tier: string, signal?: AbortSignal }} opts
 * @returns {Promise<{ name: string|null, stats: object|null, nameClass?: 'signature'|'ordinary', reason?: string }>}
 */
async function generateForgeEquipmentBundleFromMaterials(opts) {
  const key = getGeminiApiKey();
  if (!key) {
    return { name: null, stats: null, reason: 'no_api_key' };
  }

  const { resolved, tier } = opts;
  const model = getGeminiModel();
  const lines = (resolved || []).map((r, i) => {
    if (r.kind === 'catch') {
      return `${i + 1}. [낚시 재료] 이름:${JSON.stringify(String(r.itemName || ''))}, 희귀도:${String(r.rarity || 'common')}, 크기:${r.size != null ? r.size : '?'}`;
    }
    if (r.kind === 'smelt') {
      return `${i + 1}. [용광로 산출물] 이름:${JSON.stringify(String(r.name || ''))}, 등급:${String(r.rarity || 'common')}`;
    }
    return `${i + 1}. [장비 재료] 이름:${JSON.stringify(String(r.name || ''))}, 등급:${String(r.tier || 'common')}`;
  });

  const prompt = `당신은 한국어 SF·우주 낚시 톤 RPG의 장비 설계자입니다. 아래 재료로 새 장비 하나를 설계하세요.

목표 등급(능력치 상한의 기준): ${String(tier || 'common')}
재료 (참고용 — 이름에 그대로 베껴 쓰지 말 것. 분위기·재질·전설 느낌만 차용):
${lines.join('\n')}

이름(name) 규칙 — 매우 중요:
- **길이 10~24자(한글 기준 권장)**. 짧은 2~4자 낱말·난해한 합성 한 덩어리(예: 두꺼납함)는 피하고, **읽었을 때 바로 이미지가 떠오르는 무기/장비 풀네임**을 지을 것.
- **서사·시적 표현 적극 허용**: 「○○의 △△검」「□□의 심연□□」「별을 가른 …」처럼 **관형어 + 본명** 구조를 써도 좋다. 좋은 예: 달빛의 선율검, 지옥의 명멸검, 심연을 읽는 자의 파멸창, 균열 너머의 요람.
- **금지**: 낚시·용광로 재료 **이름을 두 개 이상 그대로 풀어 넣기**, **「○○와 △△의 무기」「○○·△△·□□의 무기」** 같은 인벤토리 나열 문장, **"○○ 와 △△ 와 …"** 식으로 재료만 잇기, 숫자·단위·버전표기 남발.
- 띄어쓰기는 자연스럽게(필요하면 한 칸). 괄호·따옴표·콜론은 쓰지 말 것.
- nameClass:
  - 정말 멋있거나 예쁜, 인상적인 고유 이름이면 "signature"
  - 무난하고 평범하면 "ordinary"

능력치:
2) 능력치는 **이름과 세계관에 맞게** 정할 것 (예: 방패·갑옷 느낌이면 방어가 높게, 가벼운 무기면 공격·스피드 등).
3) speedBonus: 장비에 붙는 이동/공속 보너스 비율로, 소수 **0.02~0.18** 정도 (예: 0.07 = 7%).
4) 내구도 durabilityMax: 40~220 사이 정수. durability는 신규 제작이므로 **durabilityMax와 같은 값**.
5) 숫자는 과하지 않게, 등급에 어울리게.

반드시 스키마에 맞는 JSON만 출력하세요.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const bodyStructured = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.82,
      maxOutputTokens: 256,
      topP: 0.94,
      responseMimeType: 'application/json',
      responseSchema: FORGE_BUNDLE_RESPONSE_SCHEMA,
    },
  };

  const bodyPlainJson = {
    contents: [{ parts: [{ text: `${prompt}\n\n응답은 반드시 JSON 한 덩어리만: {"name":"달빛의 잔향검","nameClass":"signature","attackBonus":0,"defenseBonus":0,"speedBonus":0.06,"durabilityMax":100,"durability":100}` }] }],
    generationConfig: {
      temperature: 0.82,
      maxOutputTokens: 256,
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
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'timeout' : 'network';
    return { name: null, stats: null, reason: msg };
  }

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    return { name: null, stats: null, reason: `http_${res.status}`, detail: body.slice(0, 400) };
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return { name: null, stats: null, reason: 'bad_json' };
  }

  const block = json?.promptFeedback?.blockReason;
  if (block) {
    return { name: null, stats: null, reason: `blocked:${block}` };
  }

  let rawText = parseGenerateContentText(json);
  if (!rawText && json?.candidates?.[0]?.content?.parts?.[0]?.text == null) {
    const inline = json?.candidates?.[0]?.content?.parts;
    if (Array.isArray(inline) && inline[0]?.text) rawText = String(inline[0].text);
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
    return { name: null, stats: null, reason: 'parse_failed' };
  }

  let nameRaw = String(parsed.name || '').trim().replace(/^["']|["']$/g, '').slice(0, 120);
  if (!nameRaw) {
    return { name: null, stats: null, reason: 'empty_name' };
  }

  if (nameViolatesForgeStyle(nameRaw, resolved)) {
    nameRaw = heuristicEquipmentNameFromResolved(resolved);
  }

  const stats = normalizeGeminiForgeStats(parsed, tier, opts.sizeExtra);
  const ncRaw = String(parsed.nameClass || '').trim().toLowerCase();
  const nameClass = ncRaw === 'signature' ? 'signature' : 'ordinary';
  return { name: nameRaw, stats, nameClass, reason: undefined };
}

module.exports = {
  generateForgeEquipmentNameFromMaterials,
  generateForgeEquipmentBundleFromMaterials,
  normalizeGeminiForgeStats,
  getGeminiApiKey,
  getGeminiModel,
  DEFAULT_MODEL,
};
