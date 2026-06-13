// 인메모리 고정 윈도우 레이트리밋 — 단일 인스턴스용(분산 불필요, Redis 안 씀).
// 오픈 알파 공개 트래픽 폭주/악용으로부터 작은 인스턴스 보호. IP별 카운트, 윈도우마다 리셋.
//
// trust proxy 가 켜져 있어(req.ip = 실제 클라이언트 IP) nginx 뒤에서도 정상 동작.
// 한계: CGNAT 등 같은 공인 IP 뒤 여러 유저는 한도를 공유 → 한도를 넉넉히 잡아 정상 유저 오탐 방지.

function createRateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }

  // 메모리 누수 방지 — 윈도우마다 만료 항목 청소
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (e.resetAt <= now) hits.delete(ip);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    let e = hits.get(ip);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(ip, e);
    }
    e.count += 1;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - e.count));
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.resetAt - now) / 1000));
      return res.status(429).json({
        error: { message: message || '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
      });
    }
    return next();
  };
}

module.exports = { createRateLimit };
