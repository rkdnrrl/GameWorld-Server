'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();

const MAX_PAGE_SIZE = 200;
const NAME_MAX = 100;
const RARITY_MAX = 20;
const TYPE_MAX = 20;

function normalizeNameParam(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > NAME_MAX) return null;
  return s;
}

/** 목록: 기본은 imageData 제외. `includeImageData=1` 이면 썸네일용으로 imageData 포함(응답 크기 증가). */
router.get('/shared-pixel-arts', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    let limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const includeImageData =
      req.query.includeImageData === '1' || req.query.includeImageData === 'true';
    if (includeImageData) {
      limit = Math.min(limit, 60);
    }

    const where =
      q.length > 0
        ? { name: { contains: q, mode: 'insensitive' } }
        : {};

    const select = includeImageData
      ? {
          name: true,
          rarity: true,
          type: true,
          createdAt: true,
          imageData: true,
        }
      : {
          name: true,
          rarity: true,
          type: true,
          createdAt: true,
        };

    const [rows, total] = await prisma.$transaction([
      prisma.sharedPixelArt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select,
      }),
      prisma.sharedPixelArt.count({ where }),
    ]);

    res.json({
      items: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

/** 단건 전체 (imageData 포함) — name 쿼리 UTF-8 */
router.get('/shared-pixel-arts/one', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const name = normalizeNameParam(req.query.name);
    if (!name) {
      return res.status(400).json({ error: { message: 'name 쿼리가 필요합니다.' } });
    }
    const row = await prisma.sharedPixelArt.findUnique({
      where: { name },
    });
    if (!row) {
      return res.status(404).json({ error: { message: '항목을 찾을 수 없습니다.' } });
    }
    res.json({ item: row });
  } catch (err) {
    next(err);
  }
});

router.patch('/shared-pixel-arts/one', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const name = normalizeNameParam(req.query.name);
    if (!name) {
      return res.status(400).json({ error: { message: 'name 쿼리가 필요합니다.' } });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const patch = {};

    if (body.rarity != null) {
      const r = String(body.rarity).trim().slice(0, RARITY_MAX);
      if (!r) return res.status(400).json({ error: { message: 'rarity가 비었습니다.' } });
      patch.rarity = r;
    }
    if (body.type != null) {
      const t = String(body.type).trim().slice(0, TYPE_MAX);
      if (!t) return res.status(400).json({ error: { message: 'type이 비었습니다.' } });
      patch.type = t;
    }
    if (body.imageData != null) {
      const img = String(body.imageData).trim();
      if (!img.startsWith('data:image/')) {
        return res.status(400).json({
          error: { message: 'imageData는 data:image/... 로 시작하는 문자열이어야 합니다.' },
        });
      }
      patch.imageData = img;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: { message: '수정할 필드가 없습니다. (rarity, type, imageData)' } });
    }

    const updated = await prisma.sharedPixelArt.update({
      where: { name },
      data: patch,
    });
    res.json({ item: updated });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { message: '항목을 찾을 수 없습니다.' } });
    }
    next(err);
  }
});

router.delete('/shared-pixel-arts/one', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const name = normalizeNameParam(req.query.name);
    if (!name) {
      return res.status(400).json({ error: { message: 'name 쿼리가 필요합니다.' } });
    }
    await prisma.sharedPixelArt.delete({ where: { name } });
    res.json({ ok: true, deleted: name });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { message: '항목을 찾을 수 없습니다.' } });
    }
    next(err);
  }
});

module.exports = router;
