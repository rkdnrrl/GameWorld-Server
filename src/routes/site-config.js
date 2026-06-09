'use strict';

/**
 * 사이트 전역 설정 (운영자가 데스크탑 앱에서 변경).
 *
 * 단순 키-값 → 기존 `appConfig` 테이블 재사용 (별도 마이그 없음).
 *
 * 키 목록:
 *   - heroVideoYouTubeId   : 랜딩 Hero 배경 YouTube 영상 ID (11자, /[A-Za-z0-9_-]/)
 *   - plazaWorldId         : 공용 광장으로 쓸 published multi 월드 ID (모두 같은 세션으로 입장)
 */
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();          // 공개: GET 만
const operatorRouter = Router();  // 운영자: PUT/DELETE

/* ── 공개 ──────────────────────────────────────────── */

// GET /api/site-config/hero-video  →  { youtubeId: string | null }
router.get('/hero-video', async (req, res, next) => {
  try {
    const cfg = await prisma.appConfig.findUnique({ where: { key: 'heroVideoYouTubeId' } });
    res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
    res.json({ youtubeId: cfg?.value || null });
  } catch (err) { next(err); }
});

/* ── 운영자 ────────────────────────────────────────── */

// PUT /api/operator/site-config/hero-video  body: { youtubeId: string | null }
operatorRouter.put('/hero-video', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const raw = req.body?.youtubeId;
    const youtubeId = raw ? String(raw).trim() : null;

    if (!youtubeId) {
      await prisma.appConfig.deleteMany({ where: { key: 'heroVideoYouTubeId' } });
      return res.json({ youtubeId: null });
    }
    // YouTube 영상 ID 형식 검증
    if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
      return res.status(400).json({
        error: { message: 'YouTube 영상 ID 는 11자 (영문/숫자/-/_) 여야 합니다.' },
      });
    }
    await prisma.appConfig.upsert({
      where:  { key: 'heroVideoYouTubeId' },
      update: { value: youtubeId },
      create: { key: 'heroVideoYouTubeId', value: youtubeId },
    });
    res.json({ youtubeId });
  } catch (err) { next(err); }
});

/* ── 공용 광장 ─────────────────────────────────────── */

// GET /api/site-config/plaza  →  { worldId: string | null, sessionId: 'plaza' }
router.get('/plaza', async (req, res, next) => {
  try {
    const cfg = await prisma.appConfig.findUnique({ where: { key: 'plazaWorldId' } });
    res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
    res.json({ worldId: cfg?.value || null, sessionId: 'plaza' });
  } catch (err) { next(err); }
});

// PUT /api/operator/site-config/plaza  body: { worldId: string | null }
operatorRouter.put('/plaza', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const raw = req.body?.worldId;
    const worldId = raw ? String(raw).trim() : null;
    if (!worldId) {
      await prisma.appConfig.deleteMany({ where: { key: 'plazaWorldId' } });
      return res.json({ worldId: null });
    }
    await prisma.appConfig.upsert({
      where:  { key: 'plazaWorldId' },
      update: { value: worldId },
      create: { key: 'plazaWorldId', value: worldId },
    });
    res.json({ worldId });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.operatorRouter = operatorRouter;
