/**
 * 공개 유저 프로필 + 그 유저의 공개 에셋 목록
 *   GET /api/users/:username/profile  — 작가 정보 + 통계
 *   GET /api/users/:username/assets   — 그 작가의 공개 에셋 (페이지네이션)
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { optionalAuth } = require('../middleware/auth');

const router = Router();
const PAGE_SIZE_DEFAULT = 40;
const PAGE_SIZE_MAX     = 100;

function serializeAsset(a) {
  if (!a) return a;
  return { ...a, fileSize: a.fileSize != null ? a.fileSize.toString() : null };
}

/* GET /api/users/:username/profile */
router.get('/:username/profile', async (req, res, next) => {
  try {
    const username = req.params.username;
    const profile = await prisma.profile.findUnique({
      where: { username },
      select: { id: true, username: true, createdAt: true },
    });
    if (!profile) return res.status(404).json({ error: { message: '유저 없음' } });

    // 통계: 공개 에셋 수, 받은 좋아요 총합, 가져간 총합
    const aggregate = await prisma.asset.aggregate({
      where: { creatorId: profile.id, isPublic: true },
      _count: { id: true },
      _sum:   { likeCount: true, importCount: true },
    });

    res.json({
      profile: {
        username:    profile.username,
        joinedAt:    profile.createdAt,
        publicCount: aggregate._count.id || 0,
        likesTotal:  aggregate._sum.likeCount || 0,
        importsTotal: aggregate._sum.importCount || 0,
      },
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
