'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();

/**
 * GET /api/operator/home-hub
 * 현재 홈허브 worldId + 월드 정보.
 */
router.get('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const cfg = await prisma.appConfig.findUnique({ where: { key: 'homeHubWorldId' } });
    const worldId = cfg?.value || null;
    let world = null;
    if (worldId) {
      world = await prisma.world.findUnique({
        where: { id: worldId },
        select: { id: true, name: true, description: true, thumbnailUrl: true, isPublic: true },
      });
    }
    res.json({ worldId, world });
  } catch (err) { next(err); }
});

/**
 * PUT /api/operator/home-hub
 * body: { worldId: string | null }
 * 홈허브 worldId 지정. null 이면 해제 → 기본 데모 섬으로 fallback.
 */
router.put('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const worldId = req.body?.worldId ? String(req.body.worldId).trim() : null;
    if (!worldId) {
      await prisma.appConfig.deleteMany({ where: { key: 'homeHubWorldId' } });
      return res.json({ worldId: null });
    }
    // 공개 월드만 허용 — 비공개면 다른 유저가 접근 불가
    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world) return res.status(404).json({ error: { message: '월드를 찾을 수 없습니다.' } });
    if (!world.isPublic) return res.status(400).json({ error: { message: '공개 월드만 홈허브로 지정 가능합니다.' } });
    await prisma.appConfig.upsert({
      where:  { key: 'homeHubWorldId' },
      update: { value: worldId },
      create: { key: 'homeHubWorldId', value: worldId },
    });
    res.json({ worldId });
  } catch (err) { next(err); }
});

module.exports = router;
