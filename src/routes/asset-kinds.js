/**
 * 에셋 타입(asset_kinds) 라우트
 * Phase 1: GET만 (모든 유저 조회 — 사이드바·업로드 허용 결정용)
 * Phase 2 에서 운영자 CRUD 추가 예정
 */
const { Router } = require('express');
const { prisma } = require('../db');

const router = Router();

/* GET /api/asset-kinds — 활성 타입 목록 (공개) */
router.get('/', async (_req, res, next) => {
  try {
    const kinds = await prisma.assetKind.findMany({
      where:   { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json({ kinds });
  } catch (err) { next(err); }
});

module.exports = router;
