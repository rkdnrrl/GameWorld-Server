const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();

const VALID_CATEGORIES = ['free', 'qna', 'tips', 'showcase'];

// 목록 조회 (공개)
router.get('/', async (req, res, next) => {
  try {
    const limit    = Math.min(30, Math.max(1, parseInt(req.query.limit) || 20));
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const category = VALID_CATEGORIES.includes(req.query.category) ? req.query.category : undefined;
    const q        = (req.query.q || '').trim().slice(0, 100);

    const where = {
      ...(category ? { category } : {}),
      ...(q ? { OR: [
        { title:   { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ]} : {}),
    };

    const [items, total] = await Promise.all([
      prisma.communityPost.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, title: true, category: true, views: true, isPinned: true, createdAt: true,
          user: { select: { id: true, nickname: true } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.communityPost.count({ where }),
    ]);

    res.json({ items, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// 상세 조회 (공개) + 조회수 증가
router.get('/:id', async (req, res, next) => {
  try {
    const post = await prisma.communityPost.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, nickname: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, nickname: true } } },
        },
      },
    });
    if (!post) return res.status(404).json({ error: { message: 'Not found' } });

    // 조회수 증가 (비동기, 오류 무시)
    prisma.communityPost.update({ where: { id: post.id }, data: { views: { increment: 1 } } }).catch(() => {});

    res.json({ post });
  } catch (err) {
    next(err);
  }
});

// 글쓰기 (로그인 필요)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { title, content, category = 'free' } = req.body;
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: { message: 'title and content required' } });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: { message: 'invalid category' } });
    }
    const post = await prisma.communityPost.create({
      data: {
        userId:   req.user.id,
        title:    title.trim().slice(0, 200),
        content:  content.trim(),
        category,
      },
    });
    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
});

// 글 수정 (본인만)
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: { message: 'Not found' } });
    if (post.userId !== req.user.id) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    const { title, content, category } = req.body;
    const data = {};
    if (title != null)    data.title    = title.trim().slice(0, 200);
    if (content != null)  data.content  = content.trim();
    if (category != null && VALID_CATEGORIES.includes(category)) data.category = category;
    const updated = await prisma.communityPost.update({ where: { id: req.params.id }, data });
    res.json({ post: updated });
  } catch (err) {
    next(err);
  }
});

// 글 삭제 (본인 또는 운영자)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: { message: 'Not found' } });
    if (post.userId !== req.user.id && !req.user.isOperator) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    await prisma.communityPost.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 댓글 작성 (로그인 필요)
router.post('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) {
      return res.status(400).json({ error: { message: 'content required' } });
    }
    const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: { message: 'Post not found' } });

    const comment = await prisma.communityComment.create({
      data: {
        postId:  req.params.id,
        userId:  req.user.id,
        content: content.trim().slice(0, 500),
      },
      include: { user: { select: { id: true, nickname: true } } },
    });
    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
});

// 댓글 삭제 (본인 또는 운영자)
router.delete('/:id/comments/:cid', requireAuth, async (req, res, next) => {
  try {
    const comment = await prisma.communityComment.findUnique({
      where: { id: BigInt(req.params.cid) },
    });
    if (!comment) return res.status(404).json({ error: { message: 'Not found' } });
    if (comment.userId !== req.user.id && !req.user.isOperator) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    await prisma.communityComment.delete({ where: { id: BigInt(req.params.cid) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 운영자: 고정 토글
router.patch('/:id/pin', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: { message: 'Not found' } });
    const updated = await prisma.communityPost.update({
      where: { id: req.params.id },
      data:  { isPinned: !post.isPinned },
    });
    res.json({ post: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
