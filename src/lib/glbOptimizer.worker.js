'use strict';
/**
 * GLB 최적화 워커 — CPU 무거운 simplify/파싱을 별도 스레드에서 실행해
 * 메인 API 이벤트 루프를 막지 않게 한다. (sharp 텍스처 리사이즈는 원래 libuv 풀이라 별개)
 *
 * worker_threads 로 1회용 실행: workerData.buffer 받아 최적화 후 결과를 postMessage.
 */
const { parentPort, workerData } = require('worker_threads');
const { optimizeGLB } = require('./glbOptimizer');

(async () => {
  try {
    const r = await optimizeGLB(workerData.buffer);
    // Buffer 는 structured clone 으로 복사되어 전달됨 (메인에서 Buffer.from 으로 복원)
    parentPort.postMessage({
      bytes:         r.reduced ? r.buffer : null,
      reduced:       r.reduced,
      originalTris:  r.originalTris,
      finalTris:     r.finalTris,
      originalBytes: r.originalBytes,
      finalBytes:    r.finalBytes,
      tex:           r.tex,
    });
  } catch (e) {
    parentPort.postMessage({ error: e && e.message ? e.message : String(e) });
  }
})();
