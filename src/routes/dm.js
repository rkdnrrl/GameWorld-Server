/**
 * DM 1:1 채팅 (Phase 19)
 *   GET    /api/dm/conversations                — 내 대화방 목록 (최신순)
 *   POST   /api/dm/conversations                — body: { withUserId } 대화방 생성/조회
 *   GET    /api/dm/conversations/:id            — 대화방 1개 (상대 유저 정보 포함)
 *   GET    /api/dm/conversations/:id/messages   — 메시지 목록 (페이지네이션)
 *   POST   /api/dm/conversations/:id/messages   — body: { body } 메시지 전송
 *   POST   /api/dm/conversations/:id/read       — 안읽은 메시지 일괄 읽음
 *   GET    /api/dm/unread-count                 — 총 안읽음 카운트
 *
 * 클라이언트는 Supabase Realtime 으로 dm_messages 테이블 변경 구독.
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { pushHubMessage } = require('./notifications');

const router = Router();
const PAGE = 50;

/** userA < userB 순으로 정렬 */
function orderPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

/** 두 유저의 대화방 찾기/생성 */
async function findOrCreateConversation(meId, otherId) {
  if (meId === otherId) throw new Error('self chat');
  const [userAId, userBId] = orderPair(meId, otherId);
  const existing = await prisma.dmConversation.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
  });
  if (existing) return existing;
  return prisma.dmConversation.create({ data: { userAId, userBId } });
}

/** 대화방의 상대 유저 id */
function otherUserId(conv, meId) {
  return conv.userAId === meId ? conv.userBId : conv.userAId;
}

// ─── 대화방 목록 ───
router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const convs = await prisma.dmConversation.findMany({
      where: { OR: [{ userAId: me }, { userBId: me }] },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 80,
    });
    if (convs.length === 0) return res.json({ conversations: [] });

    // 상대 유저 정보
    const otherIds = convs.map(c => otherUserId(c, me));
    const profiles = await prisma.profile.findMany({
      where: { id: { in: otherIds } },
      select: { id: true, username: true, profileImageUrl: true, iconEmoji: true, themeColor: true, supporterTier: true },
    });
    const pmap = new Map(profiles.map(p => [p.id, p]));

    // 각 대화방의 내 안읽음 카운트
    const unreadCounts = await Promise.all(convs.map(c =>
      prisma.dmMessage.count({
        where: { conversationId: c.id, senderId: { not: me }, readAt: null },
      })
    ));

    res.json({
      conversations: convs.map((c, i) => ({
        id: c.id,
        other: pmap.get(otherUserId(c, me)) || null,
        lastMessageAt: c.lastMessageAt,
        lastMessageText: c.lastMessageText,
        lastSenderId: c.lastSenderId,
        unread: unreadCounts[i],
      })),
    });
  } catch (err) { next(err); }
});

// ─── 대화방 생성/조회 (상대 userId 로) ───
router.post('/conversations', requireAuth, async (req, res, next) => {
  try {
    const { withUserId } = req.body || {};
    if (!withUserId) return res.status(400).json({ error: 'withUserId required' });
    if (withUserId === req.user.id) return res.status(400).json({ error: 'self chat' });
    const conv = await findOrCreateConversation(req.user.id, withUserId);
    res.json({ conversation: { id: conv.id } });
  } catch (err) { next(err); }
});

// ─── 대화방 1개 조회 ───
router.get('/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const conv = await prisma.dmConversation.findUnique({ where: { id: req.params.id } });
    if (!conv) return res.status(404).json({ error: 'not found' });
    if (conv.userAId !== me && conv.userBId !== me) return res.status(403).json({ error: 'not member' });
    const other = await prisma.profile.findUnique({
      where: { id: otherUserId(conv, me) },
      select: { id: true, username: true, profileImageUrl: true, iconEmoji: true, themeColor: true, bio: true },
    });
    res.json({ conversation: { id: conv.id, other } });
  } catch (err) { next(err); }
});

// ─── 메시지 목록 ───
router.get('/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const conv = await prisma.dmConversation.findUnique({ where: { id: req.params.id } });
    if (!conv) return res.status(404).json({ error: 'not found' });
    if (conv.userAId !== me && conv.userBId !== me) return res.status(403).json({ error: 'not member' });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const skip = (page - 1) * PAGE;
    const messages = await prisma.dmMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'desc' },
      skip, take: PAGE + 1,
    });
    const hasMore = messages.length > PAGE;
    // 오래된 → 최신 순으로 정렬해서 반환
    const rows = messages.slice(0, PAGE).reverse();
    res.json({
      messages: rows.map(m => ({
        id: m.id, senderId: m.senderId, body: m.body, createdAt: m.createdAt, readAt: m.readAt,
      })),
      page, hasMore,
    });
  } catch (err) { next(err); }
});

// ─── 메시지 전송 ───
router.post('/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const { body } = req.body || {};
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      return res.status(400).json({ error: 'body required' });
    }
    if (body.length > 2000) return res.status(400).json({ error: 'body too long' });

    const conv = await prisma.dmConversation.findUnique({ where: { id: req.params.id } });
    if (!conv) return res.status(404).json({ error: 'not found' });
    if (conv.userAId !== me && conv.userBId !== me) return res.status(403).json({ error: 'not member' });

    const trimmed = body.trim();
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const msg = await tx.dmMessage.create({
        data: { conversationId: conv.id, senderId: me, body: trimmed },
      });
      await tx.dmConversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: now, lastMessageText: trimmed.slice(0, 200), lastSenderId: me },
      });
      return msg;
    });

    // 상대에게 실시간 DM 신호 (알림벨 아님 — DM 배지/토스트용).
    // 오프라인이어도 dmMessage 가 persist 되어 unread 로 복원되므로 알림 row 불필요(고볼륨 낭비 제거).
    const recipientId = otherUserId(conv, me);
    const sender = await prisma.profile.findUnique({
      where: { id: me }, select: { username: true, profileImageUrl: true },
    });
    pushHubMessage(recipientId, {
      type: 'dm',
      dm: {
        conversationId: conv.id,
        messageId: result.id,
        fromUserId: me,
        fromUsername: sender?.username || '?',
        fromAvatar: sender?.profileImageUrl || null,
        preview: trimmed.slice(0, 80),
        createdAt: result.createdAt,
      },
    });

    res.json({
      message: {
        id: result.id, senderId: result.senderId, body: result.body,
        createdAt: result.createdAt, readAt: result.readAt,
      },
    });
  } catch (err) { next(err); }
});

// ─── 읽음 처리 ───
router.post('/conversations/:id/read', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const conv = await prisma.dmConversation.findUnique({ where: { id: req.params.id } });
    if (!conv) return res.status(404).json({ error: 'not found' });
    if (conv.userAId !== me && conv.userBId !== me) return res.status(403).json({ error: 'not member' });
    const result = await prisma.dmMessage.updateMany({
      where: { conversationId: conv.id, senderId: { not: me }, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ ok: true, updated: result.count });
  } catch (err) { next(err); }
});

// ─── 총 안읽음 카운트 ───
router.get('/unread-count', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const convIds = await prisma.dmConversation.findMany({
      where: { OR: [{ userAId: me }, { userBId: me }] },
      select: { id: true },
    });
    if (convIds.length === 0) return res.json({ unread: 0 });
    const cnt = await prisma.dmMessage.count({
      where: {
        conversationId: { in: convIds.map(c => c.id) },
        senderId: { not: me }, readAt: null,
      },
    });
    res.json({ unread: cnt });
  } catch (err) { next(err); }
});

module.exports = router;
