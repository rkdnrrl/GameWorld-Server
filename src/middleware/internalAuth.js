'use strict';

/**
 * 내부 서비스 간 webhook 인증.
 * `X-Internal-Secret` 헤더가 env `INTERNAL_WEBHOOK_SECRET` 와 정확히 일치해야 통과.
 *
 * 사용처: Common API → Platform 의 탈퇴 webhook 등 service-to-service 호출.
 */

function requireInternalSecret(req, res, next) {
  const expected = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!expected) {
    // 시크릿 미설정은 운영 사고. 호출자가 모를 수 있도록 503 으로 응답.
    console.error('[internal] INTERNAL_WEBHOOK_SECRET 이 env 에 설정되지 않음 — webhook 비활성 상태');
    return res.status(503).json({ error: { message: 'webhook not configured' } });
  }
  const provided = req.header('x-internal-secret') || '';
  if (provided !== expected) {
    return res.status(401).json({ error: { message: 'unauthorized' } });
  }
  next();
}

module.exports = { requireInternalSecret };
