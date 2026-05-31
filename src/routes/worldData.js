/**
 * 맵별 영구 데이터 저장소 (KV) — 스크립트 data.save/load/list 의 백엔드.
 *
 * userId NULL = 맵 전역 (모두 공유), userId 있음 = 플레이어 개인.
 * 권한:
 *   - 개인(personal=true) read/write — 본인만
 *   - 전역(shared=true) read 누구나, write 누구나 (단순 — 호스트 권한은 클라가 책임)
 *
 * 라우트:
 *   GET    /api/world-data/:mapId               → list (개인 + 전역 둘 다 옵션)
 *   POST   /api/world-data/:mapId/save          { key, value, shared }
 *   GET    /api/world-data/:mapId/load          ?key=...&shared=1
 *   DELETE /api/world-data/:mapId/:key          ?shared=1
 */
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

const KEY_RE = /^[\w.-]{1,120}$/;
const MAP_RE = /^[\w-]{1,40}$/;

function validateKey(k) { return typeof k === 'string' && KEY_RE.test(k); }
function validateMap(m) { return typeof m === 'string' && MAP_RE.test(m); }

// 목록 — ?scope=mine|shared|all (기본 all)
router.get('/:mapId', requireAuth, async (req, res, next) => {
  try {
    const mapId = req.params.mapId;
    if (!validateMap(mapId)) return res.status(400).json({ error: 'invalid mapId' });
    const userId = req.user.id;
    const scope = String(req.query.scope || 'all');
    const where = { mapId };
    if (scope === 'mine')       where.userId = userId;
    else if (scope === 'shared') where.userId = null;
    else                          where.OR = [{ userId }, { userId: null }];
    const rows = await prisma.worldData.findMany({
      where,
      select: { key: true, value: true, userId: true, updatedAt: true },
    });
    res.json({ items: rows.map(r => ({ key: r.key, value: r.value, shared: r.userId === null, updatedAt: r.updatedAt })) });
  } catch (e) { next(e); }
});

// 단일 load
router.get('/:mapId/load', requireAuth, async (req, res, next) => {
  try {
    const mapId = req.params.mapId;
    const key = String(req.query.key || '');
    if (!validateMap(mapId)) return res.status(400).json({ error: 'invalid mapId' });
    if (!validateKey(key))   return res.status(400).json({ error: 'invalid key' });
    const shared = req.query.shared === '1' || req.query.shared === 'true';
    const userId = shared ? null : req.user.id;
    const row = await prisma.worldData.findFirst({
      where: { mapId, userId, key },
      select: { value: true },
    });
    res.json({ value: row ? row.value : null });
  } catch (e) { next(e); }
});

// 저장 (upsert)
router.post('/:mapId/save', requireAuth, async (req, res, next) => {
  try {
    const mapId = req.params.mapId;
    const { key, value, shared } = req.body || {};
    if (!validateMap(mapId)) return res.status(400).json({ error: 'invalid mapId' });
    if (!validateKey(key))   return res.status(400).json({ error: 'invalid key' });
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    // 페이로드 크기 제한 — 한 entry 64KB
    const sz = JSON.stringify(value).length;
    if (sz > 64 * 1024) return res.status(413).json({ error: 'value too large (max 64KB)' });
    const userId = shared ? null : req.user.id;
    // userId NULL upsert 는 일반 upsert 안 됨 (composite unique 에 NULL 포함). findFirst+update/create.
    const existing = await prisma.worldData.findFirst({ where: { mapId, userId, key } });
    if (existing) {
      await prisma.worldData.update({ where: { id: existing.id }, data: { value } });
    } else {
      await prisma.worldData.create({ data: { mapId, userId, key, value } });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 삭제
router.delete('/:mapId/:key', requireAuth, async (req, res, next) => {
  try {
    const mapId = req.params.mapId;
    const key = req.params.key;
    if (!validateMap(mapId)) return res.status(400).json({ error: 'invalid mapId' });
    if (!validateKey(key))   return res.status(400).json({ error: 'invalid key' });
    const shared = req.query.shared === '1' || req.query.shared === 'true';
    const userId = shared ? null : req.user.id;
    await prisma.worldData.deleteMany({ where: { mapId, userId, key } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
