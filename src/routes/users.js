/**
 * 공개 유저 프로필 + 그 유저의 공개 에셋 목록
 *   GET /api/users/:username/profile  — 작가 정보 + 통계
 *   GET /api/users/:username/assets   — 그 작가의 공개 에셋 (페이지네이션)
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = Router();
const PAGE_SIZE_DEFAULT = 40;
const PAGE_SIZE_MAX     = 100;

function serializeAsset(a) {
  if (!a) return a;
  return { ...a, fileSize: a.fileSize != null ? a.fileSize.toString() : null };
}

/* GET /api/users/:username/profile (optionalAuth: 로그인 시 isFollowing 포함) */
router.get('/:username/profile', optionalAuth, async (req, res, next) => {
  try {
    const username = req.params.username;
    const profile = await prisma.profile.findUnique({
      where: { username },
      select: { id: true, username: true, createdAt: true, followerCount: true, followingCount: true },
    });
    if (!profile) return res.status(404).json({ error: { message: '유저 없음' } });

    const aggregate = await prisma.asset.aggregate({
      where: { creatorId: profile.id, isPublic: true },
      _count: { id: true },
      _sum:   { likeCount: true, importCount: true },
    });

    let isFollowing = false;
    const isMe = !!req.user && req.user.id === profile.id;
    if (req.user && !isMe) {
      const f = await prisma.userFollow.findUnique({
        where: { followerId_followeeId: { followerId: req.user.id, followeeId: profile.id } },
      });
      isFollowing = !!f;
    }

    res.json({
      profile: {
        username:       profile.username,
        joinedAt:       profile.createdAt,
        publicCount:    aggregate._count.id || 0,
        likesTotal:     aggregate._sum.likeCount || 0,
        importsTotal:   aggregate._sum.importCount || 0,
        followerCount:  profile.followerCount,
        followingCount: profile.followingCount,
        isFollowing,
        isMe,
      },
    });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   POST   /api/users/:username/follow
   DELETE /api/users/:username/follow
   GET    /api/users/me/following-feed   — 내가 팔로우한 사람들의 최근 공개 에셋
───────────────────────────────────────── */
router.post('/:username/follow', requireAuth, async (req, res, next) => {
  try {
    const target = await prisma.profile.findUnique({
      where: { username: req.params.username }, select: { id: true },
    });
    if (!target) return res.status(404).json({ error: { message: '유저 없음' } });
    if (target.id === req.user.id) return res.status(400).json({ error: { message: '본인은 팔로우 불가' } });

    let isNew = false;
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.userFollow.findUnique({
        where: { followerId_followeeId: { followerId: req.user.id, followeeId: target.id } },
      });
      if (existing) {
        const p = await tx.profile.findUnique({ where: { id: target.id }, select: { followerCount: true } });
        return { isFollowing: true, followerCount: p.followerCount };
      }
      isNew = true;
      await tx.userFollow.create({ data: { followerId: req.user.id, followeeId: target.id } });
      const [, p] = await Promise.all([
        tx.profile.update({ where: { id: req.user.id }, data: { followingCount: { increment: 1 } } }),
        tx.profile.update({ where: { id: target.id }, data: { followerCount:  { increment: 1 } } }),
      ]);
      return { isFollowing: true, followerCount: p.followerCount };
    });

    if (isNew) {
      require('./notifications').createNotification(target.id, 'user_followed', {
        actorName: req.user.nickname,
      });
    }
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:username/follow', requireAuth, async (req, res, next) => {
  try {
    const target = await prisma.profile.findUnique({
      where: { username: req.params.username }, select: { id: true },
    });
    if (!target) return res.status(404).json({ error: { message: '유저 없음' } });

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.userFollow.findUnique({
        where: { followerId_followeeId: { followerId: req.user.id, followeeId: target.id } },
      });
      if (!existing) {
        const p = await tx.profile.findUnique({ where: { id: target.id }, select: { followerCount: true } });
        return { isFollowing: false, followerCount: p?.followerCount ?? 0 };
      }
      await tx.userFollow.delete({
        where: { followerId_followeeId: { followerId: req.user.id, followeeId: target.id } },
      });
      const [, p] = await Promise.all([
        tx.profile.update({ where: { id: req.user.id }, data: { followingCount: { decrement: 1 } } }),
        tx.profile.update({ where: { id: target.id }, data: { followerCount:  { decrement: 1 } } }),
      ]);
      return { isFollowing: false, followerCount: Math.max(0, p.followerCount) };
    });
    res.json(result);
  } catch (err) { next(err); }
});

/* GET /api/users/me/following-feed — 페이지네이션 (sort=recent 만 지원) */
const FEED_PAGE_SIZE = 40;
router.get('/me/following-feed', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1')) || 1);

    // 내가 팔로우한 유저 id 목록
    const follows = await prisma.userFollow.findMany({
      where: { followerId: req.user.id },
      select: { followeeId: true },
    });
    const followeeIds = follows.map(f => f.followeeId);
    if (followeeIds.length === 0) {
      return res.json({ assets: [], page, pageSize: FEED_PAGE_SIZE, total: 0, hasMore: false });
    }

    const where = { creatorId: { in: followeeIds }, isPublic: true };
    const [total, assets] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * FEED_PAGE_SIZE,
        take: FEED_PAGE_SIZE,
        include: { creator: { select: { username: true } } },
      }),
    ]);

    // 좋아요 상태 함께
    const likes = await prisma.assetLike.findMany({
      where: { userId: req.user.id, assetId: { in: assets.map(a => a.id) } },
      select: { assetId: true },
    });
    const likedSet = new Set(likes.map(l => l.assetId));

    res.json({
      assets: assets.map(a => ({ ...serializeAsset(a), liked: likedSet.has(a.id) })),
      page, pageSize: FEED_PAGE_SIZE, total,
      hasMore: page * FEED_PAGE_SIZE < total,
    });
  } catch (err) { next(err); }
});

/* GET /api/users/:username/assets — sort=popular|recent|name, q, kind, page, pageSize */
router.get('/:username/assets', optionalAuth, async (req, res, next) => {
  try {
    const username = req.params.username;
    const profile = await prisma.profile.findUnique({
      where: { username },
      select: { id: true },
    });
    if (!profile) return res.status(404).json({ error: { message: '유저 없음' } });

    const q        = String(req.query.q || '').trim();
    const kind     = String(req.query.kind || '').trim();
    const sort     = String(req.query.sort || 'recent');
    const page     = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX,
      Math.max(1, parseInt(String(req.query.pageSize || PAGE_SIZE_DEFAULT)) || PAGE_SIZE_DEFAULT),
    );

    const where = { creatorId: profile.id, isPublic: true };
    if (kind) where.kind = kind;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ];
    }

    const orderBy =
      sort === 'name'    ? [{ name: 'asc' }] :
      sort === 'popular' ? [{ likeCount: 'desc' }, { importCount: 'desc' }, { createdAt: 'desc' }] :
                           [{ createdAt: 'desc' }];

    const [total, assets] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where, orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { creator: { select: { username: true } } },
      }),
    ]);

    let likedSet = new Set();
    if (req.user) {
      const likes = await prisma.assetLike.findMany({
        where: { userId: req.user.id, assetId: { in: assets.map(a => a.id) } },
        select: { assetId: true },
      });
      likedSet = new Set(likes.map(l => l.assetId));
    }

    res.json({
      assets: assets.map(a => ({ ...serializeAsset(a), liked: likedSet.has(a.id) })),
      page, pageSize, total,
      hasMore: page * pageSize < total,
    });
  } catch (err) { next(err); }
});

module.exports = router;
