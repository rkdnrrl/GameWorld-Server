/**
 * 인-월드 플레이어 신고 — 안전.
 *   유저:   POST  /api/reports/player              { userId, reason }  (requireAuth)
 *   운영자: GET   /api/operator/user-reports        (?status=pending|dismissed|resolved|all)
 *           PATCH /api/operator/user-reports/:id    { status }
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');

const router = Router();
const operatorRouter = Router();

/** 유저 차단 적용 — bannedAt=now, 사유, 정지 만료(없으면 영구). auth 미들웨어가 이 필드로 로그인/API 거부. */
async function applyBan(userId, { reason, until } = {}) {
  const u = until ? new Date(until) : null;
  await prisma.profile.update({
    where: { id: String(userId) },
    data: {
      bannedAt: new Date(),
      banReason: reason ? String(reason).slice(0, 300) : null,
      banUntil: u && !Number.isNaN(u.getTime()) ? u : null,
    },
  });
}
async function removeBan(userId) {
  await prisma.profile.update({
    where: { id: String(userId) },
    data: { bannedAt: null, banReason: null, banUntil: null },
  });
}

/* ── 유저: 신고 제출 ── */
router.post('/player', requireAuth, async (req, res, next) => {
  try {
    const { userId, reason } = req.body || {};
    if (!userId || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: '신고 대상과 사유가 필요합니다.' } });
    }
    if (String(userId) === req.user.id) {
      return res.status(400).json({ error: { code: 'SELF', message: '본인은 신고할 수 없습니다.' } });
    }
    await prisma.userReport.create({
      data: { reporterId: req.user.id, reportedId: String(userId), reason: reason.trim().slice(0, 500) },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ── 운영자: 신고 큐 ── */
operatorRouter.get('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending');
    const where = status === 'all' ? {} : { status };
    const reports = await prisma.userReport.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });
    const ids = [...new Set(reports.flatMap(r => [r.reporterId, r.reportedId]))];
    const profiles = ids.length
      ? await prisma.profile.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } })
      : [];
    const nameOf = Object.fromEntries(profiles.map(p => [p.id, p.username]));
    res.json({
      reports: reports.map(r => ({
        ...r,
        reporterName: nameOf[r.reporterId] || null,
        reportedName: nameOf[r.reportedId] || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* ── 운영자: 신고 처리 (dismiss/resolve). banUser:true 면 신고 대상 유저도 차단 ── */
operatorRouter.patch('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { status, banUser: doBan, banReason, banUntil } = req.body || {};
    if (!['pending', 'dismissed', 'resolved'].includes(status)) {
      return res.status(400).json({ error: { code: 'BAD_STATUS', message: '잘못된 상태값입니다.' } });
    }
    const report = await prisma.userReport.update({ where: { id: req.params.id }, data: { status } });
    // 신고 처리하며 대상 유저 차단(선택) — 큐에서 "처리 + 차단" 한 번에.
    if (doBan && report?.reportedId && report.reportedId !== req.user.id) {
      await applyBan(report.reportedId, { reason: banReason, until: banUntil });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ── 운영자: 유저 직접 차단 / 해제 ── */
operatorRouter.post('/ban', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { userId, reason, until } = req.body || {};
    if (!userId) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userId 필요' } });
    if (String(userId) === req.user.id) return res.status(400).json({ error: { code: 'SELF', message: '본인은 차단할 수 없습니다.' } });
    await applyBan(userId, { reason, until });
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: { message: '유저 없음' } });
    next(err);
  }
});
operatorRouter.post('/unban', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userId 필요' } });
    await removeBan(userId);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: { message: '유저 없음' } });
    next(err);
  }
});

module.exports = router;
module.exports.operatorRouter = operatorRouter;
