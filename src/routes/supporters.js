/**
 * 후원자 (Phase 20)
 *   GET    /api/supporters                 — 공개 후원자 명단 (크레딧)
 *   PATCH  /api/operator/supporters/:userId — 운영자: tier 부여/변경
 *
 * tier: 'none' / 'bronze' / 'silver' / 'gold' / 'legend'
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');

const router = Router();
const operatorRouter = Router();

const VALID_TIERS = ['none', 'bronze', 'silver', 'gold', 'legend'];
const TIER_ORDER  = { legend: 4, gold: 3, silver: 2, bronze: 1, none: 0 };

// ─── 공개 후원자 명단 ───
router.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.profile.findMany({
      where: { supporterTier: { not: 'none' } },
      select: {
        id: true, username: true, profileImageUrl: true, iconEmoji: true, themeColor: true,
        supporterTier: true, supporterSince: true, supporterNote: true, bio: true,
      },
      orderBy: { supporterSince: 'desc' },
      take: 500,
    });
    // 등급 내림차순 → 가입일 내림차순
    rows.sort((a, b) => {
      const dt = (TIER_ORDER[b.supporterTier] || 0) - (TIER_ORDER[a.supporterTier] || 0);
      if (dt !== 0) return dt;
      return new Date(b.supporterSince || 0) - new Date(a.supporterSince || 0);
    });
    res.json({ supporters: rows });
  } catch (err) { next(err); }
});

// ─── 운영자: tier 부여/변경 ───
operatorRouter.patch('/:userId', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { tier, note } = req.body || {};
    if (!VALID_TIERS.includes(tier)) {
      return res.status(400).json({ error: 'invalid tier' });
    }
    const target = await prisma.profile.findUnique({ where: { id: req.params.userId } });
    if (!target) return res.status(404).json({ error: 'user not found' });

    const data = { supporterTier: tier };
    if (typeof note === 'string') data.supporterNote = note.slice(0, 200);
    if (tier !== 'none' && !target.supporterSince) data.supporterSince = new Date();
    if (tier === 'none') data.supporterSince = null;

    const updated = await prisma.profile.update({
      where: { id: req.params.userId },
      data,
      select: { id: true, username: true, supporterTier: true, supporterSince: true, supporterNote: true },
    });
    res.json({ profile: updated });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.operatorRouter = operatorRouter;
