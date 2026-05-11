'use strict';

/**
 * 제작 장비용 PixelLab 스프라이트 (이름·티어 기반).
 * ai.js 낚시 스프라이트와 동일 API, 프롬프트만 장비에 맞게 단순화.
 */

const PIXELLAB_BASE_URL = 'https://api.pixellab.ai/v1';

const PIXEL_NEGATIVE =
  'photograph, photo realistic, 3d render, octane, smooth shading, subsurface scatter, ' +
  'wide establishing shot, tiny subject, panorama, landscape, sky, stars, nebula, galaxy, ' +
  'underwater, ocean, fish, tentacles, anime character, human face, hands, body, ' +
  'text, caption, watermark, logo, signature, QR, HUD, UI frame, speech bubble, ' +
  'motion blur, depth of field bokeh, jpeg artifacts, empty blank canvas, collage, split screen';

const RARITY_MOOD = {
  common: 'modest worn steel gray bronze tint',
  rare: 'richer teal-lavender accent subtle glow',
  epic: 'bold violet-gold accent energetic edge glow',
  legendary: 'dramatic sun-gold rim dark core mythical focus',
};

function buildEquipmentImagePrompt(name, tier) {
  const clean = String(name || '').trim().slice(0, 48);
  const r = String(tier || 'common').toLowerCase();
  const mood = RARITY_MOOD[r] || RARITY_MOOD.common;
  const parts = [
    'SNES era 16-bit pixel art RPG equipment inventory icon',
    'single object centered large on canvas thick chunky pixels',
    'weapon tool ring helm belt or armor accessory readable silhouette tiny',
    'sci-fi space forge metal crystal mix high contrast',
    mood,
    'isolated subject empty void around object alpha friendly',
    clean ? `item name flavor (do not render as text): ${JSON.stringify(clean)}` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * @param {string} name
 * @param {string} tier
 * @param {AbortSignal} [signal]
 * @returns {Promise<string|null>} data:image/png;base64,... 또는 null
 */
async function generateCraftedEquipmentPixelArt(name, tier, signal) {
  const secret = String(process.env.PIXELLAB_SECRET || '').trim();
  if (!secret) return null;

  const description = buildEquipmentImagePrompt(name, tier);

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
      console.error('[PixelLab equipment] error:', plRes.status, errText.slice(0, 400));
      return null;
    }

    const plData = await plRes.json();
    const b64 = plData?.image?.base64;
    if (!b64) {
      console.warn('[PixelLab equipment] no base64');
      return null;
    }

    const cost = plData?.usage?.usd;
    if (cost) console.log(`[PixelLab equipment] "${String(name).slice(0, 32)}" (${tier}) — $${cost.toFixed(5)}`);

    return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  } catch (err) {
    console.error('[PixelLab equipment] fetch error:', err && err.message ? err.message : err);
    return null;
  }
}

module.exports = { generateCraftedEquipmentPixelArt, buildEquipmentImagePrompt };
