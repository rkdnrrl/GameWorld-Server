const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

const VALID_RARITIES = ['common', 'rare', 'epic', 'legendary'];
const VALID_TYPES = ['fish', 'artifact', 'crystal', 'creature', 'debris'];
const MAX_COIN_VALUE = 1000;

// 포획 저장
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { itemName, itemType, rarity, size, coinValue } = req.body;

    if (!itemName || typeof itemName !== 'string' || itemName.length > 50) {
      return res.status(400).json({ error: { message: '잘못된 아이템 이름입니다.' } });
    }
    if (!VALID_RARITIES.includes(rarity)) {
      return res.status(400).json({ error: { message: '잘못된 희귀도입니다.' } });
    }
    if (!VALID_TYPES.includes(itemType)) {
      return res.status(400).json({ error: { message: '잘못된 아이템 타입입니다.' } });
    }
    const coins = Math.floor(Number(coinValue));
    if (isNaN(coins) || coins < 0 || coins > MAX_COIN_VALUE) {
      return res.status(400).json({ error: { message: '잘못된 코인 값입니다.' } });
    }

    // 포획 저장 + 코인 지급 동시 처리
    const [catchRecord] = await prisma.$transaction([
      prisma.catch.create({
        data: {
          userId: req.user.id,
          itemName: itemName.trim(),
          itemType,
          rarity,
          size: size ? Number(size) : null,
          coinValue: coins,
        },
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { coins: { increment: coins } },
      }),
    ]);

    res.json({ catch: catchRecord, coinsEarned: coins });
  } catch (err) {
    next(err);
  }
});

// 내 포획 목록 조회 (페이지네이션)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [catches, total] = await prisma.$transaction([
      prisma.catch.findMany({
        where: { userId: req.user.id },
        orderBy: { caughtAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          itemName: true,
          itemType: true,
          rarity: true,
          size: true,
          coinValue: true,
          caughtAt: true,
        },
      }),
      prisma.catch.count({ where: { userId: req.user.id } }),
    ]);

    res.json({
      catches,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// 포획 통계
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const stats = await prisma.catch.groupBy({
      by: ['rarity'],
      where: { userId: req.user.id },
      _count: { id: true },
    });

    const total = await prisma.catch.count({ where: { userId: req.user.id } });

    res.json({ total, byRarity: stats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
