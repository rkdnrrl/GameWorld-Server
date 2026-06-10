/**
 * 월드 초대 알림 (Phase 5-J) — VRChat 식 "같이 가요!" invite.
 *   POST /api/world-invites   — body: { friendId, worldId, worldName }
 *                                → friendId 에게 'world_invite' notification 생성.
 *
 * 친구 관계 검증 후만 발송 가능 (스팸 차단).
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('./notifications');

const router = Router();

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const { friendId, worldId, worldName } = req.body || {};
    if (!friendId || typeof friendId !== 'string') return res.status(400).json({ error: 'friendId required' });
    if (!worldId  || typeof worldId  !== 'string') return res.status(400).json({ error: 'worldId required' });
    if (friendId === me) return res.status(400).json({ error: 'cannot invite self' });

    // 친구 관계 검증 (accepted 만)
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: me, receiverId: friendId },
          { requesterId: friendId, receiverId: me },
        ],
      },
      select: { id: true },
    });
    if (!friendship) return res.status(403).json({ error: 'not friends' });

    // 보낸 사람 프로필 (알림 표시용)
    const actor = await prisma.profile.findUnique({
      where: { id: me },
      select: { username: true, profileImageUrl: true },
    });

    await createNotification(friendId, 'world_invite', {
      actorId: me,
      actorName: actor?.username || '?',
      actorAvatar: actor?.profileImageUrl || null,
      worldId,
      worldName: typeof worldName === 'string' ? worldName.slice(0, 120) : '',
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
