/**
 * Cloudflare Calls (Realtime) proxy 라우트 — 음성 채팅 SFU (Phase 24)
 *
 * 환경 변수:
 *   CALLS_APP_ID     — Cloudflare dashboard 에서 Realtime App 생성 후 받는 ID
 *   CALLS_APP_SECRET — 같은 App 의 Secret (서버에만 두기 — 클라에 노출 금지)
 *
 * 라우트:
 *   POST /api/voice/session/new       — 새 RTC session 생성. body: { sessionDescription }
 *   POST /api/voice/track/new         — push/pull track 등록. body: { sessionId, tracks, sessionDescription? }
 *   PUT  /api/voice/session/renegotiate — pull track 추가 시 SDP renegotiation
 *   POST /api/voice/track/close       — track 종료. body: { sessionId, tracks }
 *
 * 모든 라우트는 Cloudflare Calls REST API 를 proxy. App Secret 은 서버에만 두고,
 * 클라이언트가 Cloudflare 와 직접 통신하지 않게 함 (Secret 누출 방지).
 */
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const APP_ID     = process.env.CALLS_APP_ID || '';
const APP_SECRET = process.env.CALLS_APP_SECRET || '';
const BASE       = 'https://rtc.live.cloudflare.com/v1';

function notConfigured(res) {
  return res.status(503).json({
    error: 'Cloudflare Calls not configured. Set CALLS_APP_ID and CALLS_APP_SECRET env vars.',
  });
}

/** Cloudflare Calls API 호출 helper */
async function cfCall(path, method = 'POST', body) {
  const res = await fetch(`${BASE}/apps/${APP_ID}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${APP_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ─── 새 session 생성 ───
router.post('/session/new', requireAuth, async (req, res, next) => {
  if (!APP_ID || !APP_SECRET) return notConfigured(res);
  try {
    const { sessionDescription } = req.body || {};
    const r = await cfCall('/sessions/new', 'POST', { sessionDescription });
    if (!r.ok) return res.status(r.status).json(r.data);
    res.json(r.data);
  } catch (err) { next(err); }
});

// ─── push/pull track 등록 ───
router.post('/track/new', requireAuth, async (req, res, next) => {
  if (!APP_ID || !APP_SECRET) return notConfigured(res);
  try {
    const { sessionId, tracks, sessionDescription } = req.body || {};
    if (!sessionId || !Array.isArray(tracks)) {
      return res.status(400).json({ error: 'sessionId and tracks required' });
    }
    const body = { tracks };
    if (sessionDescription) body.sessionDescription = sessionDescription;
    const r = await cfCall(`/sessions/${sessionId}/tracks/new`, 'POST', body);
    if (!r.ok) return res.status(r.status).json(r.data);
    res.json(r.data);
  } catch (err) { next(err); }
});

// ─── SDP renegotiation (pull track 추가 시) ───
router.put('/session/renegotiate', requireAuth, async (req, res, next) => {
  if (!APP_ID || !APP_SECRET) return notConfigured(res);
  try {
    const { sessionId, sessionDescription } = req.body || {};
    if (!sessionId || !sessionDescription) {
      return res.status(400).json({ error: 'sessionId and sessionDescription required' });
    }
    const r = await cfCall(`/sessions/${sessionId}/renegotiate`, 'PUT', { sessionDescription });
    if (!r.ok) return res.status(r.status).json(r.data);
    res.json(r.data);
  } catch (err) { next(err); }
});

// ─── track 종료 ───
router.post('/track/close', requireAuth, async (req, res, next) => {
  if (!APP_ID || !APP_SECRET) return notConfigured(res);
  try {
    const { sessionId, tracks } = req.body || {};
    if (!sessionId || !Array.isArray(tracks)) {
      return res.status(400).json({ error: 'sessionId and tracks required' });
    }
    const r = await cfCall(`/sessions/${sessionId}/tracks/close`, 'POST', { tracks, force: false });
    if (!r.ok) return res.status(r.status).json(r.data);
    res.json(r.data);
  } catch (err) { next(err); }
});

// ─── 상태 확인 (운영자/디버그용) ───
router.get('/status', (_req, res) => {
  res.json({
    configured: !!(APP_ID && APP_SECRET),
    appId: APP_ID ? APP_ID.slice(0, 8) + '...' : null,
  });
});

module.exports = router;
