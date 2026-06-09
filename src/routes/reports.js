/**
 * 인-월드 플레이어 신고 — 운영자 검토용.
 *   POST /api/reports/player  { userId, reason }  (requireAuth)
 * user_reports 테이블에 적재. 운영자는 Supabase/대시보드에서 검토.
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

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
      data: {
        reporterId: req.user.id,
        reportedId: String(userId),
        reason: reason.trim().slice(0, 500),
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
