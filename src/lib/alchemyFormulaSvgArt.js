'use strict';

/**
 * 연금술 조합 산출물 썸네일 — PixelLab 없이 **화학식 느낌**의 SVG 한 장(data URL).
 */

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ primary: string, secondary?: string }} opts — primary: 식(예 H₂O), secondary: 한글 이름
 * @returns {string} data:image/svg+xml;charset=utf-8,...
 */
function generateAlchemyComposeFormulaImageDataUrl(opts) {
  const primaryRaw = (opts && opts.primary) || '—';
  const secondaryRaw = (opts && opts.secondary) || '';
  const primary = escapeXml(primaryRaw.trim().slice(0, 28));
  const secondary = escapeXml(secondaryRaw.trim().slice(0, 22));
  const plen = primary.length;
  const fsMain = plen > 18 ? 10 : plen > 12 ? 12 : plen > 8 ? 14 : 17;
  const fsSub = 7.5;
  const w = 80;
  const h = 80;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="abg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0c1610"/>
      <stop offset="55%" stop-color="#152a1f"/>
      <stop offset="100%" stop-color="#0f1f16"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" rx="9" fill="url(#abg)"/>
  <rect x="2.5" y="2.5" width="${w - 5}" height="${h - 5}" rx="7" fill="none" stroke="#3f7a55" stroke-width="1" opacity="0.85"/>
  <text x="40" y="26" text-anchor="middle" font-family="Consolas,ui-monospace,Menlo,monospace" font-size="8" fill="#6a9e7e" opacity="0.75">FORMULA</text>
  <text x="40" y="50" text-anchor="middle" font-family="Consolas,ui-monospace,Menlo,monospace" font-size="${fsMain}" font-weight="700" fill="#d4f5e3" letter-spacing="0.03em">${primary}</text>
  ${
    secondary
      ? `<text x="40" y="68" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="${fsSub}" fill="#8fbc9a" opacity="0.88">${secondary}</text>`
      : ''
  }
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

module.exports = { generateAlchemyComposeFormulaImageDataUrl };
