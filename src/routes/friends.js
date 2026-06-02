/**
 * 친구 시스템 라우트
 *   POST   /api/friends/request               — 친구 신청 보내기 (body: receiverId)
 *   POST   /api/friends/:id/accept            — 받은 신청 수락
 *   POST   /api/friends/:id/reject            — 받은 신청 거절 (=row 삭제)
 *   DELETE /api/friends/request/:id           — 보낸 신청 취소 (=row 삭제, requester 본인만)
 *   DELETE /api/friends/:userId               — 친구 끊기 (accepted 관계, 양방향 어느 쪽이든)
 *   GET    /api/friends                       — 내 친구 (accepted) 목록
 *   GET    /api/friends/pending               — 받은 신청 (pending where receiverId = me)
 *   GET    /api/friends/sent                  — 보낸 신청 (pending where requesterId = me)
 *   GET    /api/friends/check/:userId         — 그 유저와의 관계 상태 (none/pending_sent/pending_received/accepted/blocked)
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const { createActivity } = require('./activity');

const router = Router();

/** 두 user id 의 친구 관계 row 찾기 (어느 쪽이 requester 든) */
async function findFriendship(aId, bId) {
  return prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: aId, receiverId: bId },
        { requesterId: bId, receiverId: aId },
      ],
    },
  });
}

/** Profile.friendCount 양쪽 증감 (delta = +1 or -1) */
async function bumpFriendCount(tx, userIds, delta) {
  await Promise.all(userIds.map(id => tx.profile.update({
    where: { id }, data: { friendCount: { increment: delta } },
  })));
}

// ─── 친구 신청 보내기 ───
router.post('/request', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const { receiverId } = req.body || {};
    if (!receiverId || typeof receiverId !== 'string') {
      return res.status(400).json({ error: 'receiverId required' });
    }
    if (receiverId === me) return res.status(400).json({ error: 'self friend' });

    const existing = await findFriendship(me, receiverId);
    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ error: 'already friends' });
      if (existing.status === 'pending') return res.status(409).json({ error: 'already pending' });
      if (existing.status === 'blocked')  return res.status(403).json({ error: 'blocked' });
    }

    const fr = await prisma.friendship.create({
      data: { requesterId: me, receiverId, status: 'pending' },
    });

    // 알림 (받는 사람에게)
    createNotification(receiverId, 'friend_request', { friendshipId: fr.id, requesterId: me });

    res.json({ friendship: fr });
  } catch (err) { next(err); }
});

// ─── 수락 ───
router.post('/:id/accept', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const fr = await prisma.friendship.findUnique({ where: { id: req.params.id } });
    if (!fr) return res.status(404).json({ error: 'not found' });
    if (fr.receiverId !== me) return res.status(403).json({ error: 'not receiver' });
    if (fr.status !== 'pending') return res.status(409).json({ error: 'not pending' });

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.friendship.update({
        where: { id: fr.id },
        data: { status: 'accepted', respondedAt: new Date() },
      });
      await bumpFriendCount(tx, [fr.requesterId, fr.receiverId], 1);
      return u;
    });

    createNotification(fr.requesterId, 'friend_accepted', { friendshipId: fr.id, receiverId: me });

    // 활동 피드: 양쪽 모두 "친구 추가" 이벤트 (visibility: friends)
    createActivity(me, 'friend_accepted', { targetId: fr.requesterId, visibility: 'friends', payload: { with: fr.requesterId } });
    createActivity(fr.requesterId, 'friend_accepted', { targetId: me, visibility: 'friends', payload: { with: me } });

    res.json({ friendship: updated });
  } catch (err) { next(err); }
});

// ─── 거절 ───
router.post('/:id/reject', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const fr = await prisma.friendship.findUnique({ where: { id: req.params.id } });
    if (!fr) return res.status(404).json({ error: 'not found' });
    if (fr.receiverId !== me) return res.status(403).json({ error: 'not receiver' });
    if (fr.status !== 'pending') return res.status(409).json({ error: 'not pending' });
    await prisma.friendship.delete({ where: { id: fr.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 보낸 신청 취소 ───
router.delete('/request/:id', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const fr = await prisma.friendship.findUnique({ where: { id: req.params.id } });
    if (!fr) return res.status(404).json({ error: 'not found' });
    if (fr.requesterId !== me) return res.status(403).json({ error: 'not requester' });
    if (fr.status !== 'pending') return res.status(409).json({ error: 'not pending' });
    await prisma.friendship.delete({ where: { id: fr.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 친구 끊기 ───
router.delete('/:userId', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const other = req.params.userId;
    const fr = await findFriendship(me, other);
    if (!fr || fr.status !== 'accepted') return res.status(404).json({ error: 'not friends' });
    await prisma.$transaction(async (tx) => {
      await tx.friendship.delete({ where: { id: fr.id } });
      await bumpFriendCount(tx, [fr.requesterId, fr.receiverId], -1);
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── 친구 목록 (accepted) ───
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const rows = await prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: me }, { receiverId: me }],
      },
      include: {
        requester: { select: { id: true, username: true, profileImageUrl: true, bio: true, supporterTier: true } },
        receiver:  { select: { id: true, username: true, profileImageUrl: true, bio: true, supporterTier: true } },
      },
      orderBy: { respondedAt: 'desc' },
    });
    const friends = rows.map(r => ({
      friendshipId: r.id,
      since: r.respondedAt,
      friend: r.requesterId === me ? r.receiver : r.requester,
    }));
    res.json({ friends });
  } catch (err) { next(err); }
});

// ─── 받은 신청 (pending, 내가 receiver) ───
router.get('/pending', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const rows = await prisma.friendship.findMany({
      where: { status: 'pending', receiverId: me },
      include: { requester: { select: { id: true, username: true, profileImageUrl: true, bio: true, supporterTier: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ requests: rows.map(r => ({ friendshipId: r.id, createdAt: r.createdAt, from: r.requester })) });
  } catch (err) { next(err); }
});

// ─── 보낸 신청 (pending, 내가 requester) ───
router.get('/sent', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const rows = await prisma.friendship.findMany({
      where: { status: 'pending', requesterId: me },
      include: { receiver: { select: { id: true, username: true, profileImageUrl: true, bio: true, supporterTier: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ requests: rows.map(r => ({ friendshipId: r.id, createdAt: r.createdAt, to: r.receiver })) });
  } catch (err) { next(err); }
});

// ─── 관계 상태 확인 ───
router.get('/check/:userId', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const other = req.params.userId;
    if (other === me) return res.json({ state: 'self' });
    const fr = await findFriendship(me, other);
    if (!fr) return res.json({ state: 'none' });
    if (fr.status === 'accepted') return res.json({ state: 'accepted', friendshipId: fr.id });
    if (fr.status === 'blocked')  return res.json({ state: 'blocked',  friendshipId: fr.id });
    // pending
    if (fr.requesterId === me) return res.json({ state: 'pending_sent',     friendshipId: fr.id });
    return res.json({ state: 'pending_received', friendshipId: fr.id });
  } catch (err) { next(err); }
});

module.exports = router;
