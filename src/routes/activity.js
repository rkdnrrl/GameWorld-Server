/**
 * 활동 피드 (Phase 18)
 *   GET /api/activity/feed       — 친구+팔로잉 사용자들의 최근 활동 (visibility 필터)
 *   GET /api/activity/user/:id   — 특정 유저의 공개 활동
 *
 * 헬퍼:
 *   createActivity(actorId, type, { targetId, payload, visibility })
 *     — 다른 라우트에서 import 해서 호출 (asset publish, friend accept, follow 등)
 *     — best-effort: 실패해도 본 작업 진행
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();
const PAGE_SIZE = 30;

async function createActivity(actorId, type, opts = {}) {
  if (!actorId) return;
  try {
    await prisma.activityEvent.create({
      data: {
        actorId,
        type,
        targetId: opts.targetId || null,
        payload: opts.payload || {},
        visibility: opts.visibility || 'public',
      },
    });
  } catch (err) {
    console.error('[activity] create failed:', err.message);
  }
}

// ─── 내 피드 (친구 + 내가 follow 하는 사람들의 활동) ───
router.get('/feed', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const skip = (page - 1) * PAGE_SIZE;

    // 친구 id 들 (accepted)
    const friendships = await prisma.friendship.findMany({
      where: { status: 'accepted', OR: [{ requesterId: me }, { receiverId: me }] },
      select: { requesterId: true, receiverId: true },
    });
    const friendIds = new Set(friendships.map(f => f.requesterId === me ? f.receiverId : f.requesterId));

    // 팔로잉 id 들
    const following = await prisma.userFollow.findMany({
      where: { followerId: me },
      select: { followeeId: true },
    });
    const followeeIds = new Set(following.map(f => f.followeeId));

    // 두 set 합집합 (자기 자신은 빼고)
    const watchedIds = new Set([...friendIds, ...followeeIds]);
    watchedIds.delete(me);

    if (watchedIds.size === 0) {
      return res.json({ events: [], page, hasMore: false });
    }

    // visibility 필터: public 은 누구나, friends 는 친구만, followers 는 팔로워만
    const watchedArr = [...watchedIds];
    const events = await prisma.activityEvent.findMany({
      where: {
        actorId: { in: watchedArr },
        OR: [
          { visibility: 'public' },
          { visibility: 'friends',   actorId: { in: [...friendIds] } },
          { visibility: 'followers', actorId: { in: [...followeeIds] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE + 1,
    });

    const hasMore = events.length > PAGE_SIZE;
    const rows = events.slice(0, PAGE_SIZE);

    // actor 정보 hydrate
    const actorIds = [...new Set(rows.map(r => r.actorId))];
    const actors = await prisma.profile.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, username: true, profileImageUrl: true, iconEmoji: true },
    });
    const actorMap = new Map(actors.map(a => [a.id, a]));

    res.json({
      events: rows.map(e => ({
        id: e.id,
        type: e.type,
        targetId: e.targetId,
        payload: e.payload,
        createdAt: e.createdAt,
        actor: actorMap.get(e.actorId) || null,
      })),
      page,
      hasMore,
    });
  } catch (err) { next(err); }
});

// ─── 특정 유저의 공개 활동 ───
router.get('/user/:id', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const skip = (page - 1) * PAGE_SIZE;

    const events = await prisma.activityEvent.findMany({
      where: { actorId: userId, visibility: 'public' },
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE + 1,
    });

    const hasMore = events.length > PAGE_SIZE;
    res.json({
      events: events.slice(0, PAGE_SIZE).map(e => ({
        id: e.id, type: e.type, targetId: e.targetId, payload: e.payload, createdAt: e.createdAt,
      })),
      page,
      hasMore,
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.createActivity = createActivity;
