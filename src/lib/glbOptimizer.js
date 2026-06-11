/**
 * GLB 자동 최적화 — 업로드 시 1회 실행해 "로딩 가벼운" 모델로 만든다.
 *
 *   1) weld         — 중복 정점 병합
 *   2) simplify     — 폴리곤 감소 (5만 삼각형 초과 시에만)
 *   3) texture 축소 — 2048px 초과 텍스처 다운스케일 (sharp 있을 때만)
 *   4) dedup/prune  — 중복 액세서·머티리얼 제거, 미사용 노드 정리
 *
 * 로딩 렉(메인스레드 파싱·GPU 업로드)의 주범은 폴리 수 + 텍스처 크기라 이 둘을 줄인다.
 * 어떤 단계든 실패하면 원본을 그대로 반환(업로드는 절대 막지 않음).
 *
 * ⚠️ @gltf-transform v4 는 ESM 이라 CommonJS 에서 require() 불가 → 동적 import() 사용.
 */

const SKIP_THRESHOLD = 50_000;   // 이하 삼각형이면 단순화 안 함
const MID_TARGET     = 30_000;
const HIGH_TARGET    = 50_000;
const MAX_TEXTURE    = 2048;     // 텍스처 한 변 최대 px

function countTriangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) n += idx.getCount() / 3;
      else {
        const pos = prim.getAttribute('POSITION');
        if (pos) n += pos.getCount() / 3;
      }
    }
  }
  return Math.round(n);
}

function textureStats(doc) {
  let count = 0, maxDim = 0, bytes = 0;
  for (const tex of doc.getRoot().listTextures()) {
    count++;
    const img = tex.getImage();
    if (img) bytes += img.byteLength;
    const size = tex.getSize();   // [w,h] or null
    if (size) maxDim = Math.max(maxDim, size[0] || 0, size[1] || 0);
  }
  return { count, maxDim, bytes };
}

// sharp 는 선택적 — 없거나 로드 실패해도 백엔드는 정상 동작(텍스처 단계만 건너뜀)
function getSharp() {
  try { return require('sharp'); } catch { return null; }
}

/**
 * @param {Buffer} buffer  원본 GLB 버퍼
 * @returns {Promise<{ buffer: Buffer, reduced: boolean, originalTris?: number, finalTris?: number,
 *                     originalBytes?: number, finalBytes?: number, tex?: object }>}
 */
async function optimizeGLB(buffer) {
  // ESM 동적 import (CommonJS 에서 ESM 로드)
  const { NodeIO } = await import('@gltf-transform/core');
  // ⚠️ prune() 은 제외 — 합성 모델에서 참조 중인 텍스처를 제거하는 케이스 확인됨(텍스처 유실 위험).
  const { weld, simplify, dedup, textureCompress } = await import('@gltf-transform/functions');
  const meshoptMod = await import('meshoptimizer');
  const MeshoptSimplifier = meshoptMod.MeshoptSimplifier || (meshoptMod.default && meshoptMod.default.MeshoptSimplifier);
  if (MeshoptSimplifier && MeshoptSimplifier.ready) await MeshoptSimplifier.ready;

  const io = new NodeIO();
  let doc;
  try {
    doc = await io.readBinary(buffer);
  } catch (err) {
    console.warn('[glbOptimizer] GLB 파싱 실패 — 원본 유지:', err.message);
    return { buffer, reduced: false };
  }

  const originalTris = countTriangles(doc);
  const t0 = textureStats(doc);
  const sharp = getSharp();

  const steps = [weld({ tolerance: 0.0001 })];

  // 폴리 감소 (큰 모델만)
  if (originalTris > SKIP_THRESHOLD && MeshoptSimplifier) {
    const target = originalTris > 150_000 ? HIGH_TARGET : MID_TARGET;
    steps.push(simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, target / originalTris),
      error: 0.001,
      lockBorder: true,
    }));
  }

  // 텍스처 다운스케일 (sharp 있고 2048 초과 텍스처가 있을 때만) — 포맷 유지, 크기만 축소
  const willResize = !!sharp && t0.maxDim > MAX_TEXTURE;
  if (willResize) {
    steps.push(textureCompress({ encoder: sharp, resize: [MAX_TEXTURE, MAX_TEXTURE] }));
  }

  steps.push(dedup());

  try {
    await doc.transform(...steps);
  } catch (err) {
    // 스킨/애니메이션 모델은 simplify 가 실패할 수 있음 → 원본 유지
    console.warn('[glbOptimizer] 변환 실패 — 원본 유지:', err.message);
    return { buffer, reduced: false, originalTris, finalTris: originalTris, tex: { before: t0 } };
  }

  let out;
  try {
    out = Buffer.from(await io.writeBinary(doc));
  } catch (err) {
    console.warn('[glbOptimizer] GLB 쓰기 실패 — 원본 유지:', err.message);
    return { buffer, reduced: false, originalTris, finalTris: originalTris, tex: { before: t0 } };
  }

  return {
    buffer: out,
    reduced: true,
    originalTris,
    finalTris: countTriangles(doc),
    originalBytes: buffer.length,
    finalBytes: out.length,
    tex: { before: t0, after: textureStats(doc), resized: willResize, sharpAvailable: !!sharp },
  };
}

module.exports = { optimizeGLB };
