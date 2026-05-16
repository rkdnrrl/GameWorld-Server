const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();

// 공개: 최신 공지 목록
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const kind  = req.query.kind; // 'notice' | 'patch' | undefined(all)

    const where = kind ? { kind } : {};

    const [items, total] = await Promise.all([
      prisma.announcement.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, title: true, kind: true, pinned: true, createdAt: true },
      }),
      prisma.announcement.count({ where }),
    ]);

    res.json({ items, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// 공개: 공지 상세
router.get('/:id', async (req, res, next) => {
  try {
    const item = await prisma.announcement.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// 운영자: 공지 작성
router.post('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { title, body, kind = 'notice', pinned = false } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ error: { message: 'title and body required' } });
    }
    const item = await prisma.announcement.create({
      data: { title: title.trim(), body: body.trim(), kind, pinned: !!pinned },
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

// 운영자: 공지 수정
router.patch('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { title, body, kind, pinned } = req.body;
    const data = {};
    if (title != null) data.title = title.trim();
    if (body  != null) data.body  = body.trim();
    if (kind  != null) data.kind  = kind;
    if (pinned != null) data.pinned = !!pinned;
    const item = await prisma.announcement.update({ where: { id: req.params.id }, data });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// 운영자: 공지 삭제
router.delete('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    await prisma.announcement.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
