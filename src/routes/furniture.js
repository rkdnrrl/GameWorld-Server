const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

const CATALOG_PRICES = {
  floor_tile: 50,
  sofa: 120, plant: 45, lamp: 60, table: 90,
  tv: 200, rug: 75, clock: 55, art: 85,
};
const VALID_CAT_IDS = Object.keys(CATALOG_PRICES);

const SELECT_ITEM = {
  id: true, catId: true, placed: true,
  posX: true, posZ: true, rotY: true, purchasedAt: true,
};

// 내 가구 전체 조회
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const items = await prisma.furnitureItem.findMany({
      where: { userId: req.user.id },
      orderBy: { purchasedAt: 'asc' },
      select: SELECT_ITEM,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// 가구 구매 (코인 차감 + 아이템 생성)
router.post('/buy', requireAuth, async (req, res, next) => {
  try {
    const { catId } = req.body;
    if (!VALID_CAT_IDS.includes(catId)) {
      return res.status(400).json({ error: { message: '잘못된 가구입니다.' } });
    }
    const price = CATALOG_PRICES[catId];

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { coins: true },
    });
    if (!user || user.coins < price) {
      return res.status(400).json({ error: { message: '코인이 부족합니다.' } });
    }

    const [item, updatedUser] = await prisma.$transaction([
      prisma.furnitureItem.create({
        data: { userId: req.user.id, catId, placed: false },
        select: SELECT_ITEM,
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { coins: { decrement: price } },
        select: { coins: true },
      }),
    ]);

    res.json({ item, coins: updatedUser.coins });
  } catch (err) {
    next(err);
  }
});

// 가구 배치 (인벤토리 → 방)
router.patch('/:id/place', requireAuth, async (req, res, next) => {
  try {
    const { posX, posZ, rotY } = req.body;
    const existing = await prisma.furnitureItem.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: '가구를 찾을 수 없습니다.' } });
    }
    if (existing.placed) {
      return res.status(400).json({ error: { message: '이미 배치된 가구입니다.' } });
    }

    const item = await prisma.furnitureItem.update({
      where: { id: req.params.id },
      data: {
        placed: true,
        posX: Number(posX) || 0,
        posZ: Number(posZ) || 0,
        rotY: Number(rotY) || 0,
        placedAt: new Date(),
      },
      select: SELECT_ITEM,
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// 가구 위치 이동
router.patch('/:id/move', requireAuth, async (req, res, next) => {
  try {
    const { posX, posZ } = req.body;
    const existing = await prisma.furnitureItem.findFirst({
      where: { id: req.params.id, userId: req.user.id, placed: true },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: '배치된 가구를 찾을 수 없습니다.' } });
    }

    const item = await prisma.furnitureItem.update({
      where: { id: req.params.id },
      data: { posX: Number(posX) || 0, posZ: Number(posZ) || 0 },
      select: SELECT_ITEM,
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// 가구 치우기 (방 → 인벤토리)
router.patch('/:id/remove', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.furnitureItem.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) {
      return res.status(404).json({ error: { message: '가구를 찾을 수 없습니다.' } });
    }

    const item = await prisma.furnitureItem.update({
      where: { id: req.params.id },
      data: { placed: false, posX: null, posZ: null, rotY: null, placedAt: null },
      select: SELECT_ITEM,
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
