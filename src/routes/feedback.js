/**
 * 인-앱 피드백 / 버그 신고 — 오픈 알파 학습 루프.
 *   유저:   POST  /api/feedback                 { kind, message, context? }  (requireAuth)
 *   운영자: GET   /api/operator/feedback         (?status=new|reviewed|all)
 *           PATCH /api/operator/feedback/:id     { status }
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');

const router = Router();
const operatorRouter = Router();

const KINDS = ['bug', 'idea', 'other'];

/* ── 유저: 피드백 제출 ── */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { kind, message, context } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: '내용을 입력해주세요.' } });
    }
    await prisma.feedback.create({
      data: {
        userId:  req.user.id,
        kind:    KINDS.includes(kind) ? kind : 'other',
        message: message.trim().slice(0, 2000),
        context: context ? String(context).slice(0, 500) : null,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ── 운영자: 피드백 큐 ── */
operatorRouter.get('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const status = String(req.query.status || 'new');
    const where = status === 'all' ? {} : { status };
    const items = await prisma.feedback.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });
    const ids = [...new Set(items.map(i => i.userId).filter(Boolean))];
    const profiles = ids.length
      ? await prisma.profile.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } })
      : [];
    const nameOf = Object.fromEntries(profiles.map(p => [p.id, p.username]));
    res.json({ items: items.map(i => ({ ...i, username: i.userId ? (nameOf[i.userId] || null) : null })) });
  } catch (err) {
    next(err);
  }
});

/* ── 운영자: 피드백 처리 ── */
operatorRouter.patch('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!['new', 'reviewed'].includes(status)) {
      return res.status(400).json({ error: { code: 'BAD_STATUS', message: '잘못된 상태값입니다.' } });
    }
    await prisma.feedback.update({ where: { id: req.params.id }, data: { status } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.operatorRouter = operatorRouter;
