/**
 * 3D 에셋 업로드 (FBX / GLB / OBJ)
 * R2에 저장 후 DB에 메타 기록
 */
const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const r2 = require('../lib/r2');
const { optimizeGLB } = require('../lib/glbOptimizer');

const router = Router();

const CDN_BASE = 'https://play.airliveplay.com';

const ALLOWED_EXT  = new Set(['.fbx', '.glb', '.gltf', '.obj']);
const ALLOWED_MIME = new Set([
  'model/fbx', 'application/octet-stream',
  'model/gltf-binary', 'model/gltf+json',
  'model/obj', 'text/plain',
]);
const MAX_MODEL_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_THUMB_BYTES = 5   * 1024 * 1024; // 5MB

const uploadModel = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_MODEL_BYTES, files: 1 },
});

const uploadThumb = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_THUMB_BYTES, files: 1 },
});

/** 프로필 upsert 헬퍼 */
async function ensureProfile(user) {
  await prisma.profile.upsert({
    where:  { id: user.id },
    create: { id: user.id, username: user.nickname || `user_${user.id.slice(0, 6)}` },
    update: {},
  });
}

/* ─────────────────────────────────────────
   POST /api/assets/upload — FBX/GLB 업로드
───────────────────────────────────────── */
router.post('/upload', requireAuth, uploadModel.single('model'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: '파일을 첨부해주세요.' } });

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return res.status(400).json({ error: { message: `지원 형식: ${[...ALLOWED_EXT].join(', ')}` } });
    }

    const assetName = (req.body.name || path.basename(file.originalname, ext)).slice(0, 100);
    const assetId   = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const r2Key     = `assets/${req.user.id}/${assetId}${ext}`;

    // GLB/GLTF는 자동 폴리곤 감소 (FBX/OBJ는 미지원)
    let finalBuffer = file.buffer;
    let optimization = null;
    if (ext === '.glb' || ext === '.gltf') {
      try {
        const result = await optimizeGLB(file.buffer);
        finalBuffer = result.buffer;
        optimization = {
          originalTris: result.originalTris,
          finalTris:    result.finalTris,
          reduced:      result.reduced,
          sizeBefore:   file.buffer.length,
          sizeAfter:    result.buffer.length,
        };
      } catch (err) {
        console.warn('[assets] GLB 최적화 실패, 원본 업로드:', err.message);
      }
    }

    await r2.putObject(r2Key, finalBuffer, {
      contentType: file.mimetype || r2.contentType(r2Key),
    });

    const modelUrl = `${CDN_BASE}/${r2Key}`;

    await ensureProfile(req.user);

    const asset = await prisma.asset.create({
      data: {
        creatorId: req.user.id,
        name:      assetName,
        modelUrl,
        isPublic:  false,
        polyCount: optimization?.finalTris ?? null,
      },
    });

    res.json({ asset, optimization });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   POST /api/assets/:id/thumbnail — 썸네일 업로드
───────────────────────────────────────── */
router.post('/:id/thumbnail', requireAuth, uploadThumb.single('thumbnail'), async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: '이미지 첨부 필요' } });

    const ext    = path.extname(file.originalname).toLowerCase() || '.png';
    const r2Key  = `assets/${req.user.id}/thumb_${asset.id}${ext}`;
    await r2.putObject(r2Key, file.buffer, { contentType: file.mimetype });

    const thumbnailUrl = `${CDN_BASE}/${r2Key}`;
    const updated = await prisma.asset.update({
      where: { id: asset.id },
      data:  { thumbnailUrl },
    });

    res.json({ asset: updated });
  } catch (err) { next(err); }
});

/* GET /api/assets/my — 내 에셋 목록 */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const assets = await prisma.asset.findMany({
      where:   { creatorId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
    res.json({ assets });
  } catch (err) { next(err); }
});

/* GET /api/assets/public — 공개 에셋 목록 */
router.get('/public', async (req, res, next) => {
  try {
    const assets = await prisma.asset.findMany({
      where:   { isPublic: true },
      orderBy: { createdAt: 'desc' },
      take:    200,
      include: { creator: { select: { username: true } } },
    });
    res.json({ assets });
  } catch (err) { next(err); }
});

/* PATCH /api/assets/:id — 이름/공개 여부 수정 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    const data = {};
    if (req.body.name     !== undefined) data.name     = String(req.body.name).slice(0, 100);
    if (req.body.isPublic !== undefined) data.isPublic = Boolean(req.body.isPublic);

    const updated = await prisma.asset.update({ where: { id: req.params.id }, data });
    res.json({ asset: updated });
  } catch (err) { next(err); }
});

/* DELETE /api/assets/:id */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    // R2에서 파일 삭제 (실패해도 DB는 삭제)
    try {
      const key = asset.modelUrl.replace(`${CDN_BASE}/`, '');
      await r2.deleteKeys([key]);
      if (asset.thumbnailUrl) {
        const tKey = asset.thumbnailUrl.replace(`${CDN_BASE}/`, '');
        await r2.deleteKeys([tKey]);
      }
    } catch {}

    await prisma.asset.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
