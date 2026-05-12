/**
 * Singleplay-Game3 game.js 와 동일 알고리즘 — DB 저장·API 응답에서 픽셀 일관성 유지
 */

const PIXEL_PALETTES = {
  common: ['#0d1b2a', '#415a77', '#778da9', '#e0e1dd', '#1b263b', '#a8dadc'],
  rare: ['#1a0a2e', '#5a189a', '#9d4edd', '#c77dff', '#e0aaff', '#10002b'],
  epic: ['#1a0505', '#6a040f', '#9d0208', '#d00000', '#ffba08', '#370617'],
  legendary: ['#1a1200', '#b8860b', '#ffd700', '#fff4b8', '#8b6914', '#ffec8b'],
};

const PIXEL_MAX_W = 32;
const PIXEL_MAX_H = 32;
const PIXEL_MAX_PALETTE = 24;

function hashCatchSeed(item) {
  const s = `${item.name}\0${item.size}\0${item.rarity}\0${item.type}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** @param {{ name: string, size: number|string, rarity: string, type: string }} item */
function generateCatchPixelArtFromFields(item) {
  const w = 14;
  const h = 10;
  const palette = PIXEL_PALETTES[item.rarity] || PIXEL_PALETTES.common;
  let state = hashCatchSeed({
    name: item.name,
    size: item.size,
    rarity: item.rarity,
    type: item.type,
  });
  function rnd() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  }
  const cells = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const nx = ((x + 0.5) / w) * 2 - 1;
      const ny = ((y + 0.5) / h) * 2 - 1;
      const body = (nx * nx * 0.88 + ny * ny) < 0.42;
      const tail = nx < -0.32 && Math.abs(ny) < 0.4;
      const eye = nx > 0.22 && nx < 0.4 && ny > -0.12 && ny < 0.16;
      let idx;
      if (eye) {
        idx = Math.min(5, palette.length - 1);
      } else if (body || tail) {
        const strip = Math.floor((x + y + rnd() * 2) % 3);
        idx = 1 + strip;
        if (rnd() > 0.8) idx = Math.min(palette.length - 2, idx + 1);
      } else {
        idx = 0;
      }
      cells.push(idx);
    }
  }
  return { w, h, palette, cells };
}

/**
 * PixelLab / 공유 캐시 등 data URL 래스터 스프라이트
 * @param {unknown} raw
 * @returns {{ source: string, imageDataUrl: string, cacheKey?: string } | null}
 */
function validateImageDataUrlPixelArt(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const url = typeof raw.imageDataUrl === 'string' ? raw.imageDataUrl.trim() : '';
  const isRaster = /^data:image\/(png|jpeg|webp);base64,/i.test(url);
  const isSvg =
    /^data:image\/svg\+xml/i.test(url) &&
    (url.includes(';base64,') || url.includes('charset=utf-8,') || /data:image\/svg\+xml,/.test(url));
  if (!isRaster && !isSvg) return null;
  const src = typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim().slice(0, 32) : 'pixellab';
  const ck = typeof raw.cacheKey === 'string' && raw.cacheKey.trim() ? raw.cacheKey.trim().slice(0, 100) : '';
  const out = { source: src, imageDataUrl: url };
  if (ck) out.cacheKey = ck;
  return out;
}

function validatePixelArt(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const w = Number(raw.w);
  const h = Number(raw.h);
  const palette = raw.palette;
  const cells = raw.cells;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > PIXEL_MAX_W || h > PIXEL_MAX_H) {
    return null;
  }
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > PIXEL_MAX_PALETTE) return null;
  for (const c of palette) {
    if (typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c)) return null;
  }
  if (!Array.isArray(cells) || cells.length !== w * h) return null;
  const maxIdx = palette.length - 1;
  for (const idx of cells) {
    const n = Number(idx);
    if (!Number.isInteger(n) || n < 0 || n > maxIdx) return null;
  }
  return { w, h, palette, cells };
}

/**
 * DB 행에 pixelArt가 없거나 옛 데이터면, 이름·크기·희귀도·타입으로 재생성 (게임과 동일)
 * @param {object} row — itemName, itemType, rarity, size, pixelArt?
 */
function resolveCatchRowPixelArt(row) {
  const raster = validateImageDataUrlPixelArt(row.pixelArt);
  if (raster) return { ...row, pixelArt: raster };
  const existing = validatePixelArt(row.pixelArt);
  if (existing) return { ...row, pixelArt: existing };
  const sizeVal = row.size == null ? 0 : Number(row.size);
  const art = generateCatchPixelArtFromFields({
    name: row.itemName,
    size: Number.isFinite(sizeVal) ? sizeVal : 0,
    rarity: row.rarity,
    type: row.itemType,
  });
  return { ...row, pixelArt: art };
}

module.exports = {
  generateCatchPixelArtFromFields,
  validatePixelArt,
  validateImageDataUrlPixelArt,
  resolveCatchRowPixelArt,
};
