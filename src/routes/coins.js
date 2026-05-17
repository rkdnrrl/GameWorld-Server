const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

const MAX_COINS_PER_REQUEST = 10000;

// 코인 적립
router.post('/add', requireAuth, async (req, res, next) => {
  try {
    const amount = Math.floor(Number(req.body.amount));
    if (!amount || amount <= 0 || amount > MAX_COINS_PER_REQUEST) {
      return res.status(400).json({ error: { message: '올바르지 않은 코인 수량입니다.' } });
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { coins: { increment: amount } },
      select: { coins: true },
    });
    res.json({ coins: user.coins });
  } catch (err) {
    next(err);
  }
});

// 코인 차감 (낚시 등 콘텐츠 비용)
router.post('/spend', requireAuth, async (req, res, next) => {
  try {
    const amount = Math.floor(Number(req.body.amount));
    if (!amount || amount <= 0 || amount > 10000) {
      return res.status(400).json({ error: { message: '올바르지 않은 코인 수량입니다.' } });
    }
    let updatedUser;
    try {
      updatedUser = await prisma.user.update({
        where: { id: req.user.id, coins: { gte: amount } },
        data:  { coins: { decrement: amount } },
        select: { coins: true },
      });
    } catch {
      return res.status(400).json({ error: { message: '코인이 부족합니다.' } });
    }
    res.json({ ok: true, coins: updatedUser.coins });
  } catch (err) {
    next(err);
  }
});

// 현재 코인 조회
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { coins: true },
    });
    res.json({ coins: user.coins });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
