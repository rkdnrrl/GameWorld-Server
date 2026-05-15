'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');
const { ALLOWED_IDS, metaForProductId, SMELT_CATALOG } = require('../lib/smeltProduct');
const baseNouns = require('../data/baseNouns.json');
const FISHING_CACHE_PREFIX = 'shared:scrapyard:';
const equipNouns = require('../data/equipNouns.json');
const EQUIP_CACHE_PREFIX = 'equip-art:';

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

/**
 * GET /api/operator/activity-logs
 * 쿼리: action(all|fish_catch|smelt_melt|forge_craft), nickname, page, limit
 */
router.get('/activity-logs', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip  = (page - 1) * limit;
    const action   = typeof req.query.action   === 'string' && req.query.action   !== 'all' ? req.query.action.trim()   : undefined;
    const nickname = typeof req.query.nickname === 'string' && req.query.nickname.trim()    ? req.query.nickname.trim()  : undefined;

    const where = {
      ...(action   ? { action }                                      : {}),
      ...(nickname ? { nickname: { contains: nickname, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: { id: true, userId: true, nickname: true, action: true, detail: true, createdAt: true },
      }),
      prisma.activityLog.count({ where }),
    ]);

    res.json({ items: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/operator/smelt-stock/catalog — 기초 재료 전체 목록
 */
router.get('/smelt-stock/catalog', requireAuth, requireOperator, (req, res) => {
  const items = SMELT_CATALOG.map((e) => ({ id: e.id, name: e.name, emoji: e.emoji }));
  items.push({ id: 'slag', name: '고철', emoji: '🔩' });
  res.json({ items });
});

/**
 * POST /api/operator/smelt-stock/grant
 * 특정 유저에게 기초 재료를 지급합니다.
 * body: { targetNickname: string, items: [{ productId: string, count: number }] }
 */
router.post('/smelt-stock/grant', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const targetNickname = typeof body.targetNickname === 'string' ? body.targetNickname.trim() : '';
    if (!targetNickname) {
      return res.status(400).json({ error: { message: 'targetNickname이 필요합니다.' } });
    }
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ error: { message: 'items가 비었습니다.' } });
    }

    const targetUser = await prisma.user.findUnique({
      where: { nickname: targetNickname },
      select: { id: true, nickname: true },
    });
    if (!targetUser) {
      return res.status(404).json({ error: { message: `유저 "${targetNickname}"를 찾을 수 없습니다.` } });
    }

    const granted = [];
    const errors = [];
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
        const count = Math.max(1, Math.floor(Number(item.count) || 0));
        if (!productId || !ALLOWED_IDS.has(productId)) {
          errors.push(`알 수 없는 productId: ${productId}`);
          continue;
        }
        if (count <= 0) continue;
        await tx.smeltStock.upsert({
          where: { userId_productId: { userId: targetUser.id, productId } },
          update: { count: { increment: count } },
          create: { userId: targetUser.id, productId, count },
        });
        const meta = metaForProductId(productId);
        granted.push({ productId, name: meta.name, emoji: meta.emoji, count });
      }
    });

    res.json({ ok: true, targetNickname: targetUser.nickname, granted, errors });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/operator/fishing-items/status
 * baseNouns.json 명사(615개) 기준으로, 각 명사에 대한 DB 캐시 존재 여부 반환.
 * 캐시 키 = "shared:scrapyard:{형용사} {명사}" — 명사로 끝나는 항목이 하나라도 있으면 hasCache = true.
 */
router.get('/fishing-items/status', requireAuth, requireOperator, async (req, res, next) => {
  try {
    // DB에서 스크랩야드 캐시 전체 이름만 조회
    const cachedRows = await prisma.sharedPixelArt.findMany({
      where: { name: { startsWith: FISHING_CACHE_PREFIX } },
      select: { name: true },
    });

    // 각 캐시 항목에서 명사 부분 추출 (형식: "shared:scrapyard:{형용사} {명사}")
    const cachedNounSet = new Set();
    for (const row of cachedRows) {
      const itemName = row.name.slice(FISHING_CACHE_PREFIX.length);
      if (itemName.includes(' ')) {
        cachedNounSet.add(itemName.slice(itemName.indexOf(' ') + 1));
      }
    }

    const items = baseNouns.map((noun) => ({
      name: noun.name,
      emoji: noun.emoji,
      hasCache: cachedNounSet.has(noun.name),
    }));

    const cachedCount = items.filter((i) => i.hasCache).length;
    res.json({ total: items.length, cached: cachedCount, missing: items.length - cachedCount, items });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/operator/equip-art/status
 * equipNouns.json 63개 명사 기준으로 DB 캐시 존재 여부 반환.
 */
router.get('/equip-art/status', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const allKeys = equipNouns.map((n) => `${EQUIP_CACHE_PREFIX}${n.noun}`);
    const cachedRows = await prisma.sharedPixelArt.findMany({
      where: { name: { in: allKeys } },
      select: { name: true },
    });
    const cachedSet = new Set(cachedRows.map((r) => r.name));

    const items = equipNouns.map((n) => ({
      noun: n.noun,
      slot: n.slot,
      hasCache: cachedSet.has(`${EQUIP_CACHE_PREFIX}${n.noun}`),
    }));

    res.json({ total: items.length, cached: cachedSet.size, missing: items.length - cachedSet.size, items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
