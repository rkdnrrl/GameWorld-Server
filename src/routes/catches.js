const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const {
  validatePixelArt,
  generateCatchPixelArtFromFields,
  resolveCatchRowPixelArt,
} = require('../lib/catchPixelArt');
const { logActivity } = require('../lib/activityLog');
const { earnCoins } = require('../lib/commonApi');

const router = Router();

function isPixelArtColumnError(err) {
  const msg = err && err.message ? String(err.message) : '';
  return (
    /pixelArt/i.test(msg) &&
    (/does not exist/i.test(msg) ||
      /Unknown column/i.test(msg) ||
      err.code === 'P2022')
  );
}

/** 미판매 보관함 페이지 (웹 /inventory · 게임 /in-game/:gameId 공통) */
async function getUnsoldInventoryPayload(userId, page, limit) {
  const skip = (page - 1) * limit;
  const [catches, total] = await prisma.$transaction([
    prisma.catch.findMany({
      where: { userId, sold: false },
      orderBy: { caughtAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        itemName: true,
        itemEmoji: true,
        itemType: true,
        rarity: true,
        size: true,
        coinValue: true,
        caughtAt: true,
        pixelArt: true,
      },
    }),
    prisma.catch.count({ where: { userId, sold: false } }),
  ]);

  const resolved = catches.map((row) => {
    try {
      return resolveCatchRowPixelArt(row);
    } catch (e) {
      console.error('resolveCatchRowPixelArt', row?.id, e);
      return { ...row, pixelArt: null };
    }
  });

  return {
    catches: resolved,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

const VALID_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'divine'];
const VALID_TYPES = ['fish', 'artifact', 'crystal', 'creature', 'debris', 'cosmic', 'scrap'];
const MAX_COIN_VALUE = 1000;

// 포획 저장 (코인 지급 없음 — 판매 시 지급)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { itemName, itemEmoji, itemType, rarity, size, coinValue, pixelArt } = req.body;

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

    const emoji = typeof itemEmoji === 'string' ? itemEmoji.slice(0, 10) : '❓';
    let pixelArtClean = validatePixelArt(pixelArt);
    if (pixelArt != null && pixelArtClean == null) {
      return res.status(400).json({ error: { message: '잘못된 픽셀 아트 데이터입니다.' } });
    }
    const sizeNum = size == null ? null : Number(size);
    if (pixelArtClean == null) {
      pixelArtClean = generateCatchPixelArtFromFields({
        name: itemName.trim(),
        size: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : 0,
        rarity,
        type: itemType,
      });
    }

    const { catchRecord, lifetimeCatchTotal } = await prisma.$transaction(async (tx) => {
      const created = await tx.catch.create({
        data: {
          userId: req.user.id,
          itemName: itemName.trim(),
          itemEmoji: emoji,
          itemType,
          rarity,
          size: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null,
          coinValue: coins,
          sold: false,
          pixelArt: pixelArtClean,
        },
      });
      const u = await tx.user.update({
        where: { id: req.user.id },
        data: { lifetimeCatchCount: { increment: 1 } },
        select: { lifetimeCatchCount: true },
      });
      return { catchRecord: created, lifetimeCatchTotal: u.lifetimeCatchCount };
    });

    logActivity(req.user, 'fish_catch', {
      itemName: catchRecord.itemName,
      itemEmoji: catchRecord.itemEmoji,
      rarity: catchRecord.rarity,
      itemType: catchRecord.itemType,
      coinValue: catchRecord.coinValue,
    });
    res.json({ catch: catchRecord, lifetimeCatchTotal });
  } catch (err) {
    next(err);
  }
});

// 보관함 조회 (미판매 아이템)
router.get('/inventory', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 50);
    const payload = await getUnsoldInventoryPayload(req.user.id, page, limit);
    res.json(payload);
  } catch (err) {
    if (isPixelArtColumnError(err)) {
      return res.status(503).json({
        error: {
          message:
            'DB에 pixelArt 컬럼이 없습니다. 서버에서 prisma migrate deploy 또는 scripts/add-catch-pixel-art.sql 을 적용하세요.',
        },
      });
    }
    next(err);
  }
});

// 게임 클라이언트 호환: 우주 낚시 등에서 쓰는 경로 (gameId는 예약용, 현재는 전체 미판매와 동일)
router.get('/in-game/:gameId', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 50);
    const payload = await getUnsoldInventoryPayload(req.user.id, page, limit);
    res.json(payload);
  } catch (err) {
    if (isPixelArtColumnError(err)) {
      return res.status(503).json({
        error: {
          message:
            'DB에 pixelArt 컬럼이 없습니다. 서버에서 prisma migrate deploy 또는 scripts/add-catch-pixel-art.sql 을 적용하세요.',
        },
      });
    }
    next(err);
  }
});

// 아이템 판매 (코인 지급)
router.post('/sell', requireAuth, async (req, res, next) => {
  try {
    const { ids, all } = req.body;

    let where;
    if (all === true) {
      where = { userId: req.user.id, sold: false };
    } else if (Array.isArray(ids) && ids.length > 0) {
      where = { userId: req.user.id, sold: false, id: { in: ids } };
    } else {
      return res.status(400).json({ error: { message: '판매할 아이템을 선택해 주세요.' } });
    }

    const toSell = await prisma.catch.findMany({
      where,
      select: { id: true, coinValue: true },
    });

    if (toSell.length === 0) {
      return res.status(400).json({ error: { message: '판매할 아이템이 없습니다.' } });
    }

    const coinsEarned = toSell.reduce((sum, c) => sum + c.coinValue, 0);
    const sellIds = toSell.map(c => c.id);

    await prisma.catch.updateMany({
      where: { id: { in: sellIds } },
      data: { sold: true, soldAt: new Date() },
    });

    // 코인 지급 (Common API)
    earnCoins(req.user.commonUserId || req.user.id, coinsEarned, '낚시 아이템 판매', 'platform').catch(() => {});

    res.json({ sold: sellIds.length, coinsEarned });
  } catch (err) {
    next(err);
  }
});

// 내 포획 목록 조회 (페이지네이션, sold 필터 가능)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const soldFilter =
      req.query.sold === 'true' ? true :
      req.query.sold === 'false' ? false : undefined;

    const where = {
      userId: req.user.id,
      ...(soldFilter !== undefined ? { sold: soldFilter } : {}),
    };

    const [catches, total] = await prisma.$transaction([
      prisma.catch.findMany({
        where,
        orderBy: { caughtAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          itemName: true,
          itemEmoji: true,
          itemType: true,
          rarity: true,
          size: true,
          coinValue: true,
          sold: true,
          soldAt: true,
          caughtAt: true,
          pixelArt: true,
        },
      }),
      prisma.catch.count({ where }),
    ]);

    res.json({
      catches: catches.map((row) => {
        try {
          return resolveCatchRowPixelArt(row);
        } catch (e) {
          console.error('resolveCatchRowPixelArt', row?.id, e);
          return { ...row, pixelArt: null };
        }
      }),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    if (isPixelArtColumnError(err)) {
      return res.status(503).json({
        error: {
          message:
            'DB에 pixelArt 컬럼이 없습니다. 서버에서 prisma migrate deploy 또는 scripts/add-catch-pixel-art.sql 을 적용하세요.',
        },
      });
    }
    next(err);
  }
});

// 포획 통계
// 낚시 도감 — 잡은 아이템 종합 통계
router.get('/compendium', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [byType, byRarity, topItems, userRow] = await Promise.all([
      // 타입별 집계
      prisma.catch.groupBy({
        by: ['itemType'],
        where: { userId },
        _count: { id: true },
        _sum: { coinValue: true },
      }),
      // 희귀도별 집계
      prisma.catch.groupBy({
        by: ['rarity'],
        where: { userId },
        _count: { id: true },
      }),
      // 가장 많이 잡은 아이템 이름 TOP 10
      prisma.catch.groupBy({
        by: ['itemName', 'itemEmoji', 'itemType', 'rarity'],
        where: { userId },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      // 누적 수확 횟수
      prisma.user.findUnique({
        where: { id: userId },
        select: { lifetimeCatchCount: true },
      }),
    ]);

    res.json({
      lifetimeTotal: userRow?.lifetimeCatchCount ?? 0,
      byType: byType.map((r) => ({ type: r.itemType, count: r._count.id, coins: r._sum.coinValue ?? 0 })),
      byRarity: byRarity.map((r) => ({ rarity: r.rarity, count: r._count.id })),
      topItems: topItems.map((r) => ({
        name: r.itemName, emoji: r.itemEmoji, type: r.itemType,
        rarity: r.rarity, count: r._count.id,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const userRow = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { lifetimeCatchCount: true },
    });
    const [byRarity, dbCatchCount, unsold] = await Promise.all([
      prisma.catch.groupBy({
        by: ['rarity'],
        where: { userId: req.user.id },
        _count: { id: true },
      }),
      prisma.catch.count({ where: { userId: req.user.id } }),
      prisma.catch.count({ where: { userId: req.user.id, sold: false } }),
    ]);

    const lifetime = userRow?.lifetimeCatchCount ?? 0;
    /** HUD「총 획득」— Catch 행 삭제(제작 재료 등) 후에도 줄지 않도록 누적치 사용 */
    const total = Math.max(lifetime, dbCatchCount);

    res.json({ total, unsold, byRarity, dbCatchCount, lifetimeCatchCount: lifetime });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
