'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

// KST 기준 오늘 날짜 (Date 객체, 시분초=0)
function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCHours(0, 0, 0, 0);
  return kst;
}

// 미션 정의
const MISSIONS = [
  { id: 'fish_3',    label: '낚시 3회',       target: 3,  reward: 30,  icon: '🎣' },
  { id: 'dungeon_5', label: '던전 5층 도달',   target: 5,  reward: 80,  icon: '⚔️' },
  { id: 'forge_1',   label: '장비 제련 1회',   target: 1,  reward: 50,  icon: '⚒️' },
];

// 오늘 미션 현황 조회
router.get('/daily', requireAuth, async (req, res, next) => {
  try {
    const date = todayKST();
    const rows = await prisma.dailyMissionProgress.findMany({
      where: { userId: req.user.id, date },
    });
    const progressMap = Object.fromEntries(rows.map((r) => [r.missionId, r]));

    const items = MISSIONS.map((m) => {
      const row = progressMap[m.id];
      return {
        id: m.id,
        label: m.label,
        icon: m.icon,
        target: m.target,
        reward: m.reward,
        progress: row?.progress ?? 0,
        completed: row?.completed ?? false,
        rewardPaid: row?.rewardPaid ?? false,
      };
    });

    res.json({ date: date.toISOString().slice(0, 10), missions: items });
  } catch (err) {
    next(err);
  }
});

// 미션 진행도 업데이트 (게임에서 호출)
// body: { missionId, increment }
router.post('/daily/progress', requireAuth, async (req, res, next) => {
  try {
    const { missionId, increment = 1 } = req.body;
    const mission = MISSIONS.find((m) => m.id === missionId);
    if (!mission) return res.status(400).json({ error: { message: '잘못된 미션 ID입니다.' } });

    const date = todayKST();
    const inc  = Math.max(1, Math.floor(Number(increment) || 1));

    const existing = await prisma.dailyMissionProgress.findUnique({
      where: { userId_date_missionId: { userId: req.user.id, date, missionId } },
    });

    // 이미 완료된 미션은 진행도 변경 안 함
    if (existing?.completed) {
      return res.json({ ok: true, progress: existing.progress, completed: true, rewardPaid: existing.rewardPaid });
    }

    const newProgress = Math.min(mission.target, (existing?.progress ?? 0) + inc);
    const nowCompleted = newProgress >= mission.target;

    await prisma.dailyMissionProgress.upsert({
      where:  { userId_date_missionId: { userId: req.user.id, date, missionId } },
      create: { userId: req.user.id, date, missionId, progress: newProgress, completed: nowCompleted },
      update: { progress: newProgress, completed: nowCompleted },
    });

    res.json({ ok: true, progress: newProgress, completed: nowCompleted, rewardPaid: false });
  } catch (err) {
    next(err);
  }
});

// 보상 수령
router.post('/daily/claim', requireAuth, async (req, res, next) => {
  try {
    const { missionId } = req.body;
    const mission = MISSIONS.find((m) => m.id === missionId);
    if (!mission) return res.status(400).json({ error: { message: '잘못된 미션 ID입니다.' } });

    const date = todayKST();
    const row  = await prisma.dailyMissionProgress.findUnique({
      where: { userId_date_missionId: { userId: req.user.id, date, missionId } },
    });

    if (!row?.completed)   return res.status(400).json({ error: { message: '미션이 완료되지 않았습니다.' } });
    if (row?.rewardPaid)   return res.status(400).json({ error: { message: '이미 보상을 받았습니다.' } });

    const [, user] = await prisma.$transaction([
      prisma.dailyMissionProgress.update({
        where:  { userId_date_missionId: { userId: req.user.id, date, missionId } },
        data:   { rewardPaid: true },
      }),
      prisma.user.update({
        where:  { id: req.user.id },
        data:   { coins: { increment: mission.reward } },
        select: { coins: true },
      }),
    ]);

    res.json({ ok: true, reward: mission.reward, coins: user.coins });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.MISSIONS = MISSIONS;
