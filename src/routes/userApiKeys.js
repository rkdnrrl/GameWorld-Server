/**
 * 유저 개인 API 키 (OpenAI, Anthropic 등) — 본인만 조회/수정.
 *
 * 보안:
 *   - AES-256-GCM 암호화 (env API_KEY_ENCRYPTION_SECRET)
 *   - 본인만 read/write (auth.userId === row.userId)
 *   - list 는 plaintext 반환 X — 서비스 이름만
 *   - get 은 plaintext 반환 (HTTPS 필수)
 */
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const { encrypt, decrypt } = require('../lib/apiKeyCrypto');

const router = Router();
// 유저가 임의 이름으로 등록 — 영숫자·_·- 만, 1~40자
const NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/;

function isAllowed(s) { return NAME_RE.test(String(s || '')); }

/** GET /api/user/api-keys — 본인이 등록한 서비스 목록 (key plaintext X). */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rows = await prisma.userApiKey.findMany({
      where: { userId: req.user.id },
      select: { service: true, updatedAt: true, createdAt: true },
    });
    res.json({ services: rows });
  } catch (err) { next(err); }
});

/** GET /api/user/api-keys/:service — 복호화된 키 반환. 본인만. */
router.get('/:service', requireAuth, async (req, res, next) => {
  try {
    const service = String(req.params.service).toLowerCase();
    if (!isAllowed(service)) return res.status(400).json({ error: { message: '지원하지 않는 서비스' } });
    const row = await prisma.userApiKey.findUnique({
      where: { userId_service: { userId: req.user.id, service } },
    });
    if (!row) return res.status(404).json({ error: { message: '키 없음' } });
    let plaintext;
    try { plaintext = decrypt(row.encryptedKey, row.iv); }
    catch (e) { return res.status(500).json({ error: { message: '복호화 실패: ' + e.message } }); }
    res.json({ service, key: plaintext, updatedAt: row.updatedAt });
  } catch (err) { next(err); }
});

/** PUT /api/user/api-keys/:service  body: { key: "sk-..." } — 새로 저장 또는 갱신. */
router.put('/:service', requireAuth, async (req, res, next) => {
  try {
    const service = String(req.params.service).toLowerCase();
    if (!isAllowed(service)) return res.status(400).json({ error: { message: '지원하지 않는 서비스' } });
    const key = (req.body || {}).key;
    if (typeof key !== 'string' || !key.trim()) return res.status(400).json({ error: { message: 'key 필요' } });
    if (key.length > 500) return res.status(400).json({ error: { message: 'key 너무 김 (500자 초과)' } });

    let enc;
    try { enc = encrypt(key.trim()); }
    catch (e) { return res.status(500).json({ error: { message: '암호화 실패: ' + e.message } }); }

    const row = await prisma.userApiKey.upsert({
      where: { userId_service: { userId: req.user.id, service } },
      create: { userId: req.user.id, service, encryptedKey: enc.encryptedKey, iv: enc.iv },
      update: { encryptedKey: enc.encryptedKey, iv: enc.iv },
    });
    res.json({ service: row.service, updatedAt: row.updatedAt });
  } catch (err) { next(err); }
});

/** DELETE /api/user/api-keys/:service — 본인 키 삭제. */
router.delete('/:service', requireAuth, async (req, res, next) => {
  try {
    const service = String(req.params.service).toLowerCase();
    if (!isAllowed(service)) return res.status(400).json({ error: { message: '지원하지 않는 서비스' } });
    await prisma.userApiKey.deleteMany({ where: { userId: req.user.id, service } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
