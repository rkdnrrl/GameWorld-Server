const { Router } = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const { earnCoins } = require('../lib/commonApi');

const router = Router();

/**
 * 보상 종류별 정책 — 서버에서만 결정 (클라이언트가 금액 못 정함)
 *   coins       : 지급 코인
 *   cooldownMin : 같은 보상 재시청까지 대기 시간 (분)
 *   dailyMax    : 24시간 내 최대 시청 횟수
 */
const REWARDS = {
  fishing_free_cast: { coins: 5, cooldownMin: 10, dailyMax: 20 },
  dungeon_revive:    { coins: 0, cooldownMin: 5,  dailyMax: 5  },
  smelt_free:        { coins: 8, cooldownMin: 15, dailyMax: 15 },
};

const schema = z.object({
  rewardType: z.enum(Object.keys(REWARDS)),
});

router.post('/reward', requireAuth, async (req, res, next) => {
  try {
    const { rewardType } = schema.parse(req.body);
    const cfg = REWARDS[rewardType];
    const userId = req.user.id;
    const cuid = req.user.commonUserId || userId;
    const now = Date.now();

    // 쿨다운 체크
    const last = await prisma.adReward.findFirst({
      where: { userId, rewardType },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last && now - last.createdAt.getTime() < cfg.cooldownMin * 60_000) {
      const remainSec = Math.ceil(
        (cfg.cooldownMin * 60_000 - (now - last.createdAt.getTime())) / 1000,
      );
      return res.status(429).json({
        error: { message: '광고 쿨다운 중입니다.', code: 'COOLDOWN', remainSec },
      });
    }

    // 일일 한도 (24시간 슬라이딩 윈도우)
    const since = new Date(now - 24 * 60 * 60_000);
    const todayCount = await prisma.adReward.count({
      where: { userId, rewardType, createdAt: { gte: since } },
    });
    if (todayCount >= cfg.dailyMax) {
      return res.status(429).json({
        error: { message: '오늘 한도를 초과했습니다.', code: 'DAILY_LIMIT' },
      });
    }

    // 코인 지급 (Common API)
    if (cfg.coins > 0) {
      await earnCoins(cuid, cfg.coins, `ad_${rewardType}`, 'platform');
    }

    // 시청 로그
    await prisma.adReward.create({
      data: { userId, rewardType, coinsGranted: cfg.coins },
    });

    res.json({ ok: true, rewardType, coinsGranted: cfg.coins });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: '올바르지 않은 보상 종류입니다.' } });
    }
    next(err);
  }
});

/**
 * 현재 사용 가능한 보상 상태 조회 (UI 표시용)
 *   GET /api/ads/status
 *   { rewards: [{ type, coins, cooldownMin, dailyMax, remainSec, todayCount, available }] }
 */
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = Date.now();
    const since = new Date(now - 24 * 60 * 60_000);

    const rows = await prisma.adReward.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { rewardType: true, createdAt: true },
    });

    const byType = new Map();
    for (const r of rows) {
      const cur = byType.get(r.rewardType) || { count: 0, last: 0 };
      cur.count += 1;
      cur.last = Math.max(cur.last, r.createdAt.getTime());
      byType.set(r.rewardType, cur);
    }

    const rewards = Object.entries(REWARDS).map(([type, cfg]) => {
      const stat = byType.get(type) || { count: 0, last: 0 };
      const cooldownLeft = stat.last
        ? Math.max(0, cfg.cooldownMin * 60_000 - (now - stat.last))
        : 0;
      return {
        type,
        coins: cfg.coins,
        cooldownMin: cfg.cooldownMin,
        dailyMax: cfg.dailyMax,
        todayCount: stat.count,
        remainSec: Math.ceil(cooldownLeft / 1000),
        available: cooldownLeft === 0 && stat.count < cfg.dailyMax,
      };
    });

    res.json({ rewards });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
