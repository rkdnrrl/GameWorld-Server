const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

// 오래된 메시지 정리 (1시간 이상)
async function cleanup() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  await prisma.socialMessage.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {});
}

/** GET /api/social/messages — 최근 메시지 50개 (인증 불필요) */
router.get('/messages', async (req, res, next) => {
  try {
    const msgs = await prisma.socialMessage.findMany({
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true, userId: true, nickname: true, message: true, createdAt: true },
    });
    res.json({ messages: msgs });
  } catch (err) { next(err); }
});

/** POST /api/social/messages — 메시지 전송 (인증 필요) */
router.post('/messages', requireAuth, async (req, res, next) => {
  try {
    const text = String(req.body.message || '').trim().slice(0, 200);
    if (!text) return res.status(400).json({ error: { message: '메시지를 입력하세요.' } });

    const msg = await prisma.socialMessage.create({
      data: { userId: req.user.id, nickname: req.user.nickname, message: text },
      select: { id: true, userId: true, nickname: true, message: true, createdAt: true },
    });

    // 10% 확률로 오래된 메시지 정리
    if (Math.random() < 0.1) void cleanup();

    res.json({ message: msg });
  } catch (err) { next(err); }
});

module.exports = router;
