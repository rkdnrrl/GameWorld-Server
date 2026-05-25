/**
 * 알림 라우트
 *   GET    /api/notifications              — 내 알림 목록 (페이지네이션)
 *   GET    /api/notifications/unread-count — 안읽음 카운트 (벨 배지)
 *   PATCH  /api/notifications/:id/read     — 단일 읽음
 *   POST   /api/notifications/read-all     — 전체 읽음
 *
 * 헬퍼:
 *   createNotification(userId, type, payload)
 *     — 다른 라우트에서 import 해서 호출 (like/follow/report 등)
 *     — userId === actor 면 무시 (본인 행동에 본인 알림 불필요)
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();
const PAGE_SIZE = 30;

/** 알림 생성 (실패해도 throw 안함 — best-effort) */
async function createNotification(userId, type, payload = {}) {
  if (!userId) return;
  try {
    await prisma.notification.create({ data: { userId, type, payload } });
  } catch (err) {
    // 알림 실패가 본 작업을 중단시키지 않도록 swallow
    console.error('[notification] create failed:', err.message);
  }
}

/* GET /api/notifications */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const [total, items, unread] = await Promise.all([
      prisma.notification.count({ where: { userId: req.user.id } }),
      prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
    ]);
    res.json({
      notifications: items,
      page, pageSize: PAGE_SIZE, total, unread,
      hasMore: page * PAGE_SIZE < total,
    });
  } catch (err) { next(err); }
});

/* GET /api/notifications/unread-count */
router.get('/unread-count', requireAuth, async (req, res, next) => {
  try {
    const unread = await prisma.notification.count({
      where: { userId: req.user.id, readAt: null },
    });
    res.json({ unread });
  } catch (err) { next(err); }
});

/* PATCH /api/notifications/:id/read */
router.patch('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!n) return res.status(404).json({ error: { message: '없음' } });
    if (n.userId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });
    if (n.readAt) return res.json({ ok: true });
    await prisma.notification.update({
      where: { id: n.id }, data: { readAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* POST /api/notifications/read-all */
router.post('/read-all', requireAuth, async (req, res, next) => {
  try {
    const r = await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data:  { readAt: new Date() },
    });
    res.json({ ok: true, marked: r.count });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.createNotification = createNotification;
