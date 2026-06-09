/**
 * 데일리 출석 보상 — 매일 1회 코인 지급 + 연속 출석(streak).
 *   GET  /api/attendance/status   (requireAuth) → { claimedToday, streak, reward, coins }
 *   POST /api/attendance/claim    (requireAuth) → { streak, reward, coins }  (중복 시 409)
 * 날짜는 KST(UTC+9) 기준. daily_attendance 복합 PK(userId, date) 로 하루 1회 보장.
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// 7일 주기 보상 — 7일차 보너스. streak 이 길어도 7일 주기로 반복.
const REWARD_TABLE = [100, 120, 140, 160, 180, 200, 300];
const rewardFor = (streak) => REWARD_TABLE[(Math.max(1, streak) - 1) % 7];

/** KST 기준 날짜 문자열(YYYY-MM-DD). offsetDays 만큼 가감. */
function kstDateStr(offsetDays = 0) {
  const ms = Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}
const dateObj = (str) => new Date(str + 'T00:00:00.000Z');
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

async function computeNextStreak(userId) {
  const yesterday = kstDateStr(-1);
  const latest = await prisma.dailyAttendance.findFirst({
    where: { userId }, orderBy: { date: 'desc' },
  });
  if (latest && ymd(latest.date) === yesterday) return latest.streak + 1;
  return 1;
}

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const today = kstDateStr();
    const [todayRow, profile] = await Promise.all([
      prisma.dailyAttendance.findUnique({ where: { userId_date: { userId: req.user.id, date: dateObj(today) } } }),
      prisma.profile.findUnique({ where: { id: req.user.id }, select: { coins: true } }),
    ]);
    const claimedToday = !!todayRow;
    const streak = claimedToday ? todayRow.streak : await computeNextStreak(req.user.id);
    res.json({
      claimedToday,
      streak,
      reward: rewardFor(streak),
      coins: profile?.coins ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/claim', requireAuth, async (req, res, next) => {
  try {
    const today = kstDateStr();
    const existing = await prisma.dailyAttendance.findUnique({
      where: { userId_date: { userId: req.user.id, date: dateObj(today) } },
    });
    if (existing) {
      return res.status(409).json({ error: { code: 'ALREADY_CLAIMED', message: '오늘은 이미 출석했습니다.' } });
    }
    const streak = await computeNextStreak(req.user.id);
    const reward = rewardFor(streak);

    const result = await prisma.$transaction(async (tx) => {
      await tx.dailyAttendance.create({
        data: { userId: req.user.id, date: dateObj(today), streak, coinsGranted: reward },
      });
      const updated = await tx.profile.update({
        where: { id: req.user.id },
        data: { coins: { increment: reward } },
        select: { coins: true },
      });
      return updated.coins;
    });
    res.json({ streak, reward, coins: result });
  } catch (err) {
    // 동시 요청으로 PK 충돌 → 이미 출석 처리
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: { code: 'ALREADY_CLAIMED', message: '오늘은 이미 출석했습니다.' } });
    }
    next(err);
  }
});

module.exports = router;
