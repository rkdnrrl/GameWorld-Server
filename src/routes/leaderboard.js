'use strict';

const { Router } = require('express');
const { prisma } = require('../db');

const router = Router();

// 던전 최고 층수 TOP 20
router.get('/dungeon', async (req, res, next) => {
  try {
    const rows = await prisma.userRecord.findMany({
      where: { dungeonMaxFloor: { gt: 0 } },
      orderBy: [{ dungeonMaxFloor: 'desc' }, { dungeonMaxKills: 'desc' }],
      take: 20,
      include: { user: { select: { nickname: true } } },
    });
    res.json({
      items: rows.map((r, i) => ({
        rank: i + 1,
        nickname: r.user.nickname,
        floor: r.dungeonMaxFloor,
        kills: r.dungeonMaxKills,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// 낚시 누적 수확량 TOP 20 (lifetimeCatchCount 기준)
router.get('/fishing', async (req, res, next) => {
  try {
    const rows = await prisma.user.findMany({
      where: { lifetimeCatchCount: { gt: 0 } },
      orderBy: { lifetimeCatchCount: 'desc' },
      take: 20,
      select: { nickname: true, lifetimeCatchCount: true },
    });
    res.json({
      items: rows.map((r, i) => ({
        rank: i + 1,
        nickname: r.nickname,
        count: r.lifetimeCatchCount,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
