/**
 * 유저 접속 위치 (presence) — 친구 위치 표시용.
 *   POST   /api/presence            — heartbeat (body: { worldId }). 30초마다 클라가 ping.
 *   DELETE /api/presence            — 명시적 offline (창 닫기·월드 이탈)
 *   GET    /api/presence/friends    — 내 친구 중 현재 접속 중인 위치
 *
 * "현재 접속" 기준: updatedAt > NOW - 90초 (heartbeat 30초 간격의 3배 여유).
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// 90초 — 30초 heartbeat 의 3배 여유
const ONLINE_WINDOW_MS = 90 * 1000;

// ─── heartbeat (upsert) ───
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const { worldId } = req.body || {};
    if (!worldId || typeof worldId !== 'string') {
      return res.status(400).json({ error: 'worldId required' });
    }
    await prisma.userPresence.upsert({
      where:  { userId: me },
      update: { worldId, updatedAt: new Date() },
      create: { userId: me, worldId },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 명시적 offline ───
router.delete('/', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    await prisma.userPresence.deleteMany({ where: { userId: me } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 내 친구 중 접속 중인 위치 ───
router.get('/friends', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    // 친구 (accepted) 목록 조회
    const friendships = await prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: me }, { receiverId: me }],
      },
      select: { requesterId: true, receiverId: true },
    });
    const friendIds = friendships.map(f => f.requesterId === me ? f.receiverId : f.requesterId);
    if (friendIds.length === 0) return res.json({ locations: [] });

    const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
    const presences = await prisma.userPresence.findMany({
      where: { userId: { in: friendIds }, updatedAt: { gt: cutoff } },
    });
    if (presences.length === 0) return res.json({ locations: [] });

    // 친구 프로필 (username, profileImageUrl) 함께 반환
    const profiles = await prisma.profile.findMany({
      where: { id: { in: presences.map(p => p.userId) } },
      select: { id: true, username: true, profileImageUrl: true },
    });
    const byId = new Map(profiles.map(p => [p.id, p]));

    const locations = presences
      .map(p => {
        const prof = byId.get(p.userId);
        if (!prof) return null;
        return {
          userId:           p.userId,
          username:         prof.username,
          profileImageUrl:  prof.profileImageUrl,
          worldId:          p.worldId,
          updatedAt:        p.updatedAt.toISOString(),
        };
      })
      .filter(Boolean);

    res.json({ locations });
  } catch (err) { next(err); }
});

module.exports = router;
