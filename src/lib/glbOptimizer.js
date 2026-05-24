/**
 * GLB 자동 최적화 — 폴리곤 감소 + 중복 제거
 *
 * 정책:
 *   - 삼각형 50,000개 이하: 건드리지 않음
 *   - 50,000 ~ 150,000:   30,000개로 축소
 *   - 150,000 초과:        50,000개로 축소 (디테일 보존)
 */
const { NodeIO } = require('@gltf-transform/core');
const { weld, simplify, dedup, prune } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');

const SKIP_THRESHOLD = 50_000;   // 이하면 손대지 않음
const MID_TARGET     = 30_000;
const HIGH_TARGET    = 50_000;

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

/**
 * @param {Buffer} buffer    원본 GLB 버퍼
 * @returns {Promise<{ buffer: Buffer, originalTris: number, finalTris: number, reduced: boolean }>}
 */
async function optimizeGLB(buffer) {
  await MeshoptSimplifier.ready;

  const io  = new NodeIO();
  const doc = await io.readBinary(buffer);

  const originalTris = countTriangles(doc);

  // 임계값 이하면 그대로
  if (originalTris <= SKIP_THRESHOLD) {
    return { buffer, originalTris, finalTris: originalTris, reduced: false };
  }

  const target = originalTris > 150_000 ? HIGH_TARGET : MID_TARGET;
  const ratio  = Math.min(1, target / originalTris);

  try {
    await doc.transform(
      weld({ tolerance: 0.0001 }),               // 중복 정점 병합
      simplify({                                 // 메쉬 단순화
        simplifier: MeshoptSimplifier,
        ratio,
        error: 0.001,                            // 형태 보존 정확도 (낮을수록 더 정확)
        lockBorder: true,                        // 가장자리 보존 → UV 경계 유지
      }),
      dedup(),                                   // 중복 액세서/머티리얼 제거
      prune(),                                   // 미사용 노드 정리
    );
  } catch (err) {
    // 스킨/애니메이션이 있으면 simplify가 실패할 수 있음 → 원본 반환
    console.warn('[glbOptimizer] simplify 실패 (원본 유지):', err.message);
    return { buffer, originalTris, finalTris: originalTris, reduced: false };
  }

  const out       = await io.writeBinary(doc);
  const finalTris = countTriangles(doc);

  return {
    buffer: Buffer.from(out),
    originalTris,
    finalTris,
    reduced: true,
  };
}

module.exports = { optimizeGLB };
