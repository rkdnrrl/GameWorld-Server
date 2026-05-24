/**
 * Meshy AI 프록시
 * API 키를 서버에서 보관, 클라이언트에 노출 안 함
 */
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();
const MESHY_API = 'https://api.meshy.ai';
const MESHY_KEY = process.env.MESHY_API_KEY || '';

function meshyHeaders() {
  return {
    'Authorization': `Bearer ${MESHY_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** POST /api/meshy/text-to-3d — 텍스트→3D 작업 생성 */
router.post('/text-to-3d', requireAuth, async (req, res, next) => {
  try {
    if (!MESHY_KEY) return res.status(503).json({ error: { message: 'Meshy API 키가 설정되지 않았습니다.' } });

    const { prompt, artStyle = 'realistic', negativePrompt = '' } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: { message: '프롬프트를 입력하세요.' } });

    const r = await fetch(`${MESHY_API}/v2/text-to-3d`, {
      method: 'POST',
      headers: meshyHeaders(),
      body: JSON.stringify({
        mode: 'preview',
        prompt: String(prompt).trim().slice(0, 500),
        art_style: artStyle,
        negative_prompt: negativePrompt,
      }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: { message: err.message || 'Meshy 오류' } });
    }

    const { result: taskId } = await r.json();
    res.json({ taskId });
  } catch (err) { next(err); }
});

/** GET /api/meshy/task/:taskId — 작업 상태 조회 */
router.get('/task/:taskId', requireAuth, async (req, res, next) => {
  try {
    if (!MESHY_KEY) return res.status(503).json({ error: { message: 'Meshy API 키 없음' } });

    const r = await fetch(`${MESHY_API}/v2/text-to-3d/${req.params.taskId}`, {
      headers: meshyHeaders(),
    });

    if (!r.ok) return res.status(r.status).json({ error: { message: 'Meshy 조회 실패' } });

    const task = await r.json();
    // status: PENDING | IN_PROGRESS | SUCCEEDED | FAILED
    res.json({
      status:       task.status,
      progress:     task.progress || 0,
      modelUrl:     task.model_urls?.glb || null,
      thumbnailUrl: task.thumbnail_url  || null,
    });
  } catch (err) { next(err); }
});

/** POST /api/meshy/save — 완성된 에셋을 DB에 저장 */
router.post('/save', requireAuth, async (req, res, next) => {
  try {
    const { taskId, name, modelUrl, thumbnailUrl } = req.body;
    if (!modelUrl || !name?.trim()) {
      return res.status(400).json({ error: { message: 'modelUrl 과 name 이 필요합니다.' } });
    }

    // 프로필 보장
    await prisma.profile.upsert({
      where:  { id: req.user.id },
      create: { id: req.user.id, username: req.user.nickname || `user_${req.user.id.slice(0,6)}` },
      update: {},
    });

    const asset = await prisma.asset.create({
      data: {
        creatorId:    req.user.id,
        name:         String(name).trim().slice(0, 100),
        meshyTaskId:  taskId || null,
        modelUrl:     String(modelUrl),
        thumbnailUrl: thumbnailUrl || null,
        isPublic:     false,
      },
    });

    res.json({ asset });
  } catch (err) { next(err); }
});

/** GET /api/meshy/assets — 내 에셋 목록 */
router.get('/assets', requireAuth, async (req, res, next) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { creatorId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ assets });
  } catch (err) { next(err); }
});

/** GET /api/meshy/assets/public — 공개 에셋 목록 */
router.get('/assets/public', async (req, res, next) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ assets });
  } catch (err) { next(err); }
});

module.exports = router;
