'use strict';

const { heuristicEquipmentNameFromResolved, hangulOnly } = require('./forgeHeuristicName');
const {
  proceduralSmeltForgeName,
  resolvedMaterialsAreSmeltOnly,
} = require('./forgeSmeltProceduralName');

/** Google AI Studio / Gemini API — Flash-Lite 계열 */
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

/** 유저 개인 제련 기본값: 웅장·시그니처급 이름 슬롯 (나머지는 초라한 장비 톤). env `FORGE_GRAND_SIGNATURE_RATE`로 0~1 조절. */
const DEFAULT_FORGE_GRAND_SIGNATURE_RATE = 1 / 100_000;

function getForgeGrandSignatureRate() {
  const raw = process.env.FORGE_GRAND_SIGNATURE_RATE;
  if (raw == null || String(raw).trim() === '') return DEFAULT_FORGE_GRAND_SIGNATURE_RATE;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_FORGE_GRAND_SIGNATURE_RATE;
  return n;
}

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

/** 주 모델이 404/스키마 오류 등으로 실패할 때 한 번 더 시도 (미설정 시 gemini-2.0-flash) */
const DEFAULT_FALLBACK_MODEL = 'gemini-2.0-flash';

function getGeminiFallbackModelId(primary) {
  const p = String(primary || '').trim();
  const fb = String(process.env.GEMINI_MODEL_FALLBACK || DEFAULT_FALLBACK_MODEL).trim();
  if (!fb || fb === p) return '';
  return fb;
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
        'Korean gear name: usually shabby/broken-tone 6–22 chars; rarely 10–24 char epic poetic title; no raw material inventory listing',
    },
    visualHintEn: {
      type: 'STRING',
      description:
        'English only max 22 words: concrete silhouette for pixel icon of THE SAME object as name (materials shapes). Must match category e.g. gloves→gloves not metal rod',
    },
    attackBonus: { type: 'INTEGER', description: 'Attack bonus integer' },
    defenseBonus: { type: 'INTEGER', description: 'Defense bonus integer' },
    speedBonus: { type: 'NUMBER', description: 'Speed multiplier 0.02–0.20 (e.g. 0.08)' },
    durabilityMax: { type: 'INTEGER', description: 'Max durability points' },
    durability: { type: 'INTEGER', description: 'Current durability; new craft equals max' },
    nameClass: {
      type: 'STRING',
      description:
        'signature only for rare epic-poetic names; otherwise always ordinary (see prompt branch)',
    },
    itemTier: {
      type: 'STRING',
      description:
        'common | rare | epic | legendary from name impressiveness only; shabby names stay common–rare; never from material stats',
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

const VALID_ITEM_TIERS = ['common', 'rare', 'epic', 'legendary'];

/** 모델이 고른 희귀도(이름 멋짐 기준)를 정규화. 누락 시 nameClass로만 보조. signature면 최소 rare. */
function normalizeGeminiItemTier(parsed) {
  const raw = String(parsed.itemTier || parsed.equipmentTier || '').trim().toLowerCase();
  const nc = String(parsed.nameClass || '').trim().toLowerCase();
  const idx = (x) => {
    const i = VALID_ITEM_TIERS.indexOf(x);
    return i >= 0 ? i : 0;
  };
  let t = VALID_ITEM_TIERS.includes(raw) ? raw : nc === 'signature' ? 'epic' : 'common';
  if (nc === 'signature' && idx(t) < idx('rare')) t = 'rare';
  return t;
}

/**
 * 모델 출력을 itemTier(이름 기반) 상한으로 클램프.
 * @param {object} raw
 * @param {string} tier — common|rare|epic|legendary (Gemini itemTier)
 */
function normalizeGeminiForgeStats(raw, tier) {
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
 * 이름 + 희귀도(itemTier) + 능력치 + 내구도를 한 번에.
 * 서정·시그니처 톤은 기본 약 1/100000(`DEFAULT_FORGE_GRAND_SIGNATURE_RATE`)만 허용 — 나머지는 초라한 장비 톤.
 * @param {{ resolved: object[], signal?: AbortSignal }} opts
 * @returns {Promise<{ name: string|null, visualHintEn?: string|null, stats: object|null, tier?: string, nameClass?: 'signature'|'ordinary', reason?: string }>}
 */
async function generateForgeEquipmentBundleFromMaterials(opts) {
  const key = getGeminiApiKey();
  if (!key) {
    return { name: null, stats: null, reason: 'no_api_key' };
  }

  const { resolved } = opts;
  const model = getGeminiModel();
  const signatureRate = getForgeGrandSignatureRate();
  const grandSignatureRoll = Math.random() < signatureRate;

  const lines = (resolved || []).map((r, i) => {
    const mood =
      r.kind === 'catch'
        ? String(r.itemName || '').trim()
        : String(r.name || '').trim();
    return `${i + 1}. 재료에서 떠오르는 분위기·소재 힌트(문구 그대로 복사·재료 나열 금지): ${JSON.stringify(mood || '알 수 없음')}`;
  });

  const modeBlock = grandSignatureRoll
    ? `=== 이번 제련 출력 모드: 특별 분기 (개인 장비에서는 거의 나오지 않는 극히 드문 슬롯) ===
이번에만 이름은 **반드시** 웅장·시적·서사적으로 인상적인 풀네임으로 짓는다 (한글 대략 10~24자 권장).
예시 톤: 달빛의 선율검, 지옥의 명멸검, 심연을 읽는 자의 파멸창, 균열 너머의 요람.
nameClass는 반드시 "signature". itemTier는 이름에 맞게 epic 또는 legendary 중 하나.
이 모드에서는 멋없는 초라한 이름을 쓰면 안 된다.`
    : `=== 이번 제련 출력 모드: 일반 분기 (거의 모든 개인 제련이 여기에 해당) ===
이름은 **멋지지 않게** 초라하고 현실감·패잔병·고물 느낌으로 짓는다 (한글 대략 6~22자).
찢어진·부숴진·다 부숴진·낡은·쓸모없는·엉성한·반쯤 망가진·녹슨·깨진·누더기·허접한 같은 어휘를 적극 활용해도 좋다.
좋은 예시 톤: 찢어진 검, 부숴진 검, 다 부숴진 고철방패, 쓸모없는 창, 낡아빠진 나무방패, 반쪽난 도끼, 엉성하게 박은 철판방패.
서정적·웅장한 시어체 제목은 **이번 모드에서는 금지** (「○○의 △△검」 같은 대작 톤 이름 금지).
nameClass는 반드시 "ordinary". itemTier는 이름이 초라하므로 **common을 기본**으로 하고, 가끔 rare까지. epic·legendary는 이번 모드에서 쓰지 말 것.`;

  const prompt = `당신은 한국어 SF·우주 낚시 톤 RPG의 장비 설계자입니다. 아래 재료로 새 장비 하나를 설계하세요.

재료 (참고용 — 이름에 그대로 베껴 쓰지 말 것. 분위기·재질·전설 느낌만 차용. 재료의 게임 내 희귀도·크기는 **판단에 사용하지 말 것**):
${lines.join('\n')}

${modeBlock}

공통 규칙:
- **금지**: 낚시·용광로 재료 **이름을 두 개 이상 그대로 풀어 넣기**, **「○○와 △△의 무기」「○○·△△·□□의 무기」** 같은 인벤토리 나열 문장, **"○○ 와 △△ 와 …"** 식으로 재료만 잇기, 숫자·단위·버전표기 남발.
- 띄어쓰기는 자연스럽게(필요하면 한 칸). 괄호·따옴표·콜론은 쓰지 말 것.

**이름 ↔ 스프라이트 실루엣 (필수 — 불일치 금지)**  
- **visualHintEn** 필드: **영어만**, 최대 **22단어**. 위에서 지은 **한글 name과 정확히 같은 범주의 물건**이 픽셀 아이콘으로 보이도록, **보이는 형태·재질·대략적 각도**만 쓸 것 (문장·스토리·한국어 금지).  
- 예: name이 **가죽 장갑·망치 장갑** 류이면 → \`worn brown leather work gloves pair front view thick cuff visible fingers\` 처럼 **장갑 실루엣**.  
- name이 **검·도끼·창·방패·투구·반지·벨트** 등이면 그에 맞는 **무기·방어구 실루엣**을 영어로.  
- **절대 금지**: name은 장갑·옷·가죽인데 visualHintEn을 **금속 실린더·피스톤·랜덤 기계 부품·추상 블록**으로 쓰는 것. name이 말하는 **물건 종류**와 visualHintEn의 **종류**가 다르면 실패입니다.

itemTier (희귀도): common | rare | epic | legendary 중 하나. **위 모드 설명을 반드시 따를 것.** 재료 희귀도·크기는 반영하지 말 것.

능력치:
1) 능력치는 **이름·itemTier·세계관에 맞게** 정할 것 (예: 방패·갑옷 느낌이면 방어가 높게, 가벼운 무기면 공격·스피드 등). 숫자 상한은 **반드시 itemTier**와 일치할 것.
2) speedBonus: 장비에 붙는 이동/공속 보너스 비율로, 소수 **0.02~0.18** 정도 (예: 0.07 = 7%).
3) 내구도 durabilityMax: 40~220 사이 정수. durability는 신규 제작이므로 **durabilityMax와 같은 값**.
4) 숫자는 과하지 않게, itemTier에 어울리게.

반드시 스키마에 맞는 JSON만 출력하세요.`;

  const geminiUrl = (modelId) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`;

  const genCfgTokens = {
    temperature: 0.82,
    maxOutputTokens: 384,
    topP: 0.94,
    responseMimeType: 'application/json',
  };

  const bodyStructured = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      ...genCfgTokens,
      responseSchema: FORGE_BUNDLE_RESPONSE_SCHEMA,
    },
  };

  const bodyPlainJson = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\n응답은 반드시 JSON 한 덩어리만: {"name":"찢어진 검","visualHintEn":"chipped iron shortsword single edge worn crossguard leather wrap grip front view","itemTier":"common","nameClass":"ordinary","attackBonus":8,"defenseBonus":2,"speedBonus":0.06,"durabilityMax":100,"durability":100}`,
          },
        ],
      },
    ],
    generationConfig: { ...genCfgTokens },
  };

  const fallbackId = getGeminiFallbackModelId(model);

  const post = async (modelId, body) =>
    fetch(geminiUrl(modelId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

  let res;
  try {
    res = await post(model, bodyStructured);
    if (!res.ok) {
      res = await post(model, bodyPlainJson);
    }
    if (!res.ok && fallbackId) {
      const resFb = await post(fallbackId, bodyPlainJson);
      if (resFb.ok) {
        console.warn('[geminiEquipmentName] primary model failed; used fallback:', fallbackId);
        res = resFb;
      }
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
    console.warn(
      '[geminiEquipmentName] generateContent failed:',
      res.status,
      body.slice(0, 280),
    );
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

  const originalGeminiName = String(parsed.name || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .slice(0, 120);

  let nameRaw = originalGeminiName;
  if (!nameRaw) {
    return { name: null, stats: null, reason: 'empty_name' };
  }

  let visualHintEn = sanitizeForgeVisualHintEn(parsed.visualHintEn);

  if (nameViolatesForgeStyle(nameRaw, resolved)) {
    nameRaw = resolvedMaterialsAreSmeltOnly(resolved)
      ? proceduralSmeltForgeName(resolved)
      : heuristicEquipmentNameFromResolved(resolved);
    visualHintEn = null;
  }

  let geminiTier = normalizeGeminiItemTier(parsed);
  const ncRaw = String(parsed.nameClass || '').trim().toLowerCase();
  let nameClass = ncRaw === 'signature' ? 'signature' : 'ordinary';

  if (!grandSignatureRoll) {
    nameClass = 'ordinary';
    const ti = VALID_ITEM_TIERS.indexOf(geminiTier);
    if (ti > VALID_ITEM_TIERS.indexOf('rare')) geminiTier = 'rare';
  }

  const stats = normalizeGeminiForgeStats(parsed, geminiTier);
  return { name: nameRaw, visualHintEn, stats, tier: geminiTier, nameClass, reason: undefined };
}

/** PixelLab용 영어 실루엣 — 한글·문장 혼입 시 제거 */
function sanitizeForgeVisualHintEn(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 280);
  if (!s) return null;
  if (/[\u3131-\uAC00\uAC01-\uD79D]/.test(s)) return null;
  if (!/[a-zA-Z]/.test(s)) return null;
  return s;
}

module.exports = {
  generateForgeEquipmentNameFromMaterials,
  generateForgeEquipmentBundleFromMaterials,
  normalizeGeminiForgeStats,
  getGeminiApiKey,
  getGeminiModel,
  getGeminiFallbackModelId,
  getForgeGrandSignatureRate,
  DEFAULT_MODEL,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_FORGE_GRAND_SIGNATURE_RATE,
};
