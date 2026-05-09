const { Router } = require('express');
const { prisma } = require('../db');

const router = Router();

const GAME_API_KEY = process.env.GAME_API_KEY || 'game-secret-key';
const MAX_COINS_PER_REQUEST = 10000;

// 게임 서버 전용 인증 미들웨어
function requireGameAuth(req, res, next) {
  const key = req.headers['x-game-api-key'];
  if (!key || key !== GAME_API_KEY) {
    return res.status(401).json({ error: { message: '게임 서버 인증 실패' } });
  }
  next();
}

// POST /api/coins/add — 게임 서버가 유저에게 코인 지급
router.post('/add', requireGameAuth, async (req, res, next) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || typeof amount !== 'number' || amount <= 0 || amount > MAX_COINS_PER_REQUEST) {
      return res.status(400).json({ error: { message: '잘못된 요청입니다.' } });
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { coins: { increment: Math.floor(amount) } },
      select: { id: true, coins: true },
    });
    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
