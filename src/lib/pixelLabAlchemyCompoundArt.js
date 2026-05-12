'use strict';

/**
 * 연금술 조합 산출물(artifact)용 PixelLab 64×64 — 장비용 모듈과 동일 API 엔드포인트, 프롬프트만 조정.
 */

const PIXELLAB_BASE_URL = 'https://api.pixellab.ai/v1';

const PIXEL_NEGATIVE =
  'photograph, photo realistic, 3d render, octane, smooth shading, ' +
  'wide establishing shot, tiny subject, panorama, landscape, sky, ' +
  'underwater ocean fish tentacles, anime character, human face, hands, body, ' +
  'text, caption, watermark, logo, signature, QR, HUD, UI frame, speech bubble, ' +
  'motion blur, depth of field bokeh, jpeg artifacts, empty blank canvas, collage, split screen, ' +
  'sword shield armor weapon unrelated to alchemy';

const RARITY_MOOD = {
  common: 'modest dusty bottle muted earth tones',
  rare: 'subtle teal-violet shimmer small glow',
  epic: 'bold violet-gold accent energetic edge glow',
  legendary: 'dramatic sun-gold rim dark core mythical focus',
};

function buildAlchemyCompoundImagePrompt(nameKo, rarity, visualHintEn) {
  const clean = String(nameKo || '').trim().slice(0, 48);
  const hint = typeof visualHintEn === 'string' ? visualHintEn.trim().slice(0, 220) : '';
  const r = String(rarity || 'common').toLowerCase();
  const mood = RARITY_MOOD[r] || RARITY_MOOD.common;

  const primary = hint
    ? `PRIMARY SILHOUETTE — draw exactly this object, no substitution: ${hint}`
    : 'single fantasy alchemy product: small vial OR corked bottle OR crystal OR powder pile OR orb OR sealed pouch, one clear readable object';

  const parts = [
    'SNES era 16-bit pixel art RPG inventory loot icon',
    'single object centered large on canvas thick chunky pixels',
    primary,
    mood,
    'isolated subject empty void around object alpha friendly no table',
    clean
      ? `Korean title flavor only never paint letters or text: ${JSON.stringify(clean)}`
      : null,
    'materials glass ceramic metal dust liquid glow as implied by PRIMARY',
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * @param {string} nameKo
 * @param {string} rarity
 * @param {AbortSignal} [signal]
 * @param {string|null} [visualHintEn]
 * @returns {Promise<string|null>} data:image/png;base64,... 또는 null
 */
async function generateAlchemyCompoundPixelArt(nameKo, rarity, signal, visualHintEn) {
  const secret = String(process.env.PIXELLAB_SECRET || '').trim();
  if (!secret) return null;

  const description = buildAlchemyCompoundImagePrompt(nameKo, rarity, visualHintEn);

  try {
    const plRes = await fetch(`${PIXELLAB_BASE_URL}/generate-image-pixflux`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        description,
        image_size: { width: 64, height: 64 },
        negative_description: PIXEL_NEGATIVE,
        text_guidance_scale: 7.25,
        no_background: true,
      }),
      signal: signal || undefined,
    });

    if (!plRes.ok) {
      const errText = await plRes.text().catch(() => '');
      console.error('[PixelLab alchemy compound] error:', plRes.status, errText.slice(0, 400));
      return null;
    }

    const plData = await plRes.json();
    const b64 = plData?.image?.base64;
    if (!b64) {
      console.warn('[PixelLab alchemy compound] no base64');
      return null;
    }

    const cost = plData?.usage?.usd;
    if (cost) {
      console.log(`[PixelLab alchemy compound] "${String(nameKo).slice(0, 32)}" (${rarity}) — $${cost.toFixed(5)}`);
    }

    return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  } catch (err) {
    console.error('[PixelLab alchemy compound] fetch error:', err && err.message ? err.message : err);
    return null;
  }
}

module.exports = { generateAlchemyCompoundPixelArt, buildAlchemyCompoundImagePrompt };
