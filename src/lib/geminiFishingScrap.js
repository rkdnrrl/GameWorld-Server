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
        'Korean max 22 chars: everyday object OR scrapyard/metal part (coil, bearing, beam, gear); vary domain each call — avoid clustering one domain',
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
 * 일반(common) 회수 아이템 — 생활 폐품·용품과 **고철·야적·금속가공 부품** 모두 허용 (Gemini).
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ name: string, emoji: string, visualEn: string } | null>}
 */
async function generateFishingScrapNameBundle(opts = {}) {
  const key = getGeminiApiKey();
  if (!key) return null;

  const model = getGeminiModel();

  const ROTATING_DIVERSITY_HINTS = [
    '이번 출력 방향: **정원·베란다·화분** 쪽 물건이면 좋습니다.',
    '이번 출력 방향: **욕실·세탁·수건** 쪽 생활용품이면 좋습니다.',
    '이번 출력 방향: **옷·신발·모자·가방** 등 패션·잡화면 좋습니다.',
    '이번 출력 방향: **운동·요가·헬스** 소품이면 좋습니다.',
    '이번 출력 방향: **주방·식사·보관** 용기나 도구면 좋습니다.',
    '이번 출력 방향: **책상·문구·정리** 사무·학습 소품이면 좋습니다.',
    '이번 출력 방향: **악기·취미·완구** 류이면 좋습니다.',
    '이번 출력 방향: **가구·조명·인테리어**(PC 본체·모니터 제외)면 좋습니다.',
    '이번 출력 방향: **공구·캠핑·차량 소품**(가벼운 소형)이면 좋습니다.',
    '이번 출력 방향: **PC·전자**여도 **키보드·마우스만 반복하지 말고** 모니터·충전기·SSD·스피커·시계 등 다른 것.',
    '이번 출력 방향: **야적·고철·설비 잔재** — 와이어코일, 베어링, 형강, I빔·H빔, 체인, 브라켓, 플랜지, 밸브, 슬래그, 압연재 등 **구체적 금속·기계 부품** 이름이면 좋습니다.',
    '이번 출력 방향: **금속 가공·용접·기계 부품** — 톱니바퀴, 기어, 샤프트, 용접봉·전극, 퓨즈박스, 케이블릴, 철판 절단편 등 **알아보이는 파츠**면 좋습니다.',
  ];
  const hintIdx = Math.floor(Date.now() / 2500) % ROTATING_DIVERSITY_HINTS.length;

  const prompt = `당신은 우주 낚시 게임의 작명가입니다. 플레이어가 우주 잔해에서 "일반(common)" 등급 아이템 하나를 건졌습니다.

**이름 톤 — 아래 두 가지 모두 게임에 필요합니다 (한 응답에는 하나만)**  
**(A) 생활 폐품·용품**: 가전·가구·옷·식물·문구·주방·욕실 등 실제로 볼 수 있는 사물명.  
**(B) 고철·야적·금속가공 부품**: 와이어코일, 베어링, 형강, I빔·H빔, 체인, 브라켓, 플랜지, 밸브, 기어, 톱니, 슬래그, 압연재, 용접봉, 케이블릴 등 **구체적으로 어떤 부품인지 드러나는** 이름. (B)는 "고철 카테고리"이므로 **허용·환영**입니다.

**금지**  
- **특징 없는** 한 마디만: 예) "쇳덩이", "금속 조각"처럼 형태·종류가 전혀 안 드러나는 이름만 단독으로 내기.  
- (B)를 낼 때는 반드시 **부품 종류**가 이름에 보이게 할 것.

**다채로움 — 한쪽만 독점하지 말 것**  
- 이번에 삽입된 **라우팅 힌트 한 줄**에 "야적·고철·금속 가공·용접·기계 부품" 같은 말이 들어가 있으면 이번 응답은 **(B) 고철·야적 부품** 쪽으로 잡을 것. 그렇지 않으면 **(A) 생활 폐품·용품**을 우선. 전체적으로 (A)와 (B)가 **골고루** 나오게 생각할 것.  
- PC·전자만, 가구만, 식물만 연속으로 나오면 좋지 않습니다.  
- **PC·전자**(A) 비중은 상대적으로 낮게; 나올 때 **키보드·유선키보드·기계식키보드**만 반복하지 말고 모니터·충전기·SSD·헤드셋·스피커·USB허브·시계 등을 섞습니다.

**범주 예시 (이번 이름은 그중 하나의 "맛"만 — 나열 금지)**  
- 생활·가구: 책상, 의자, 선풍기, 베개 …  
- 패션·욕실·주방·사무·악기·PC·전자: (각각 익숙한 사물명 한 가지)  
- **고철·야적 (B)**: 녹슨 와이어코일, 소형 베어링, 형강 절단편, 체인 링크, 용접 브라켓, 플랜지 디스크 …

${ROTATING_DIVERSITY_HINTS[hintIdx]}

이름(name): 한국어 **22자 이내**, **익숙한 사물명** 한 가지만. 나열·설명 문장 금지.

emoji: 그 물건에 맞는 이모지 **1개**. 물고기·바다·생물 이모지 금지.

visualEn: PixelLab용 **영어만**, 최대 24단어. **그 물건의 실제 실루엣**(재질: 금속·플라스틱·천·나무 등 자연스럽게). 사람·문장·한국어 금지.

아래 JSON만 출력하세요.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const bodyStructured = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.93,
      maxOutputTokens: 220,
      topP: 0.96,
      responseMimeType: 'application/json',
      responseSchema: FISHING_SCRAP_RESPONSE_SCHEMA,
    },
  };

  const FEW_SHOT_JSON = [
    '{"name":"창틀 화분","emoji":"🪴","visualEn":"small terracotta flower pot with sprout on windowsill"}',
    '{"name":"운동 헤어밴드","emoji":"🎀","visualEn":"elastic fabric sports headband simple stripe"}',
    '{"name":"책갈피 세트","emoji":"🔖","visualEn":"flat paper bookmarks ribbon ends assorted colors"}',
    '{"name":"녹슨 와이어코일","emoji":"🔗","visualEn":"rusted steel wire coil tight cylindrical loops industrial scrapyard piece"}',
    '{"name":"소형 롤러베어링","emoji":"⚙️","visualEn":"small steel roller bearing outer ring inner ring visible balls"}',
  ];
  const fewShot = FEW_SHOT_JSON[Math.floor(Date.now() / 2500) % FEW_SHOT_JSON.length];

  const bodyPlainJson = {
    contents: [
      {
        parts: [
          {
            text: `${prompt}\n\n응답은 반드시 JSON 한 덩어리만: ${fewShot}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.93,
      maxOutputTokens: 220,
      topP: 0.96,
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
