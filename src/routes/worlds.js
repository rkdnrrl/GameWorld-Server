const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

/** GET /api/worlds/public — 공개 월드 목록 */
router.get('/public', async (req, res, next) => {
  try {
    const worlds = await prisma.world.findMany({
      where: { isPublic: true },
      orderBy: { playCount: 'desc' },
      take: 50,
      select: {
        id: true, name: true, description: true, thumbnailUrl: true,
        playCount: true, createdAt: true,
        creator: { select: { username: true } },
      },
    });
    res.json({ worlds });
  } catch (err) { next(err); }
});

/** GET /api/worlds/my — 내 월드 목록 */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const worlds = await prisma.world.findMany({
      where: { creatorId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
    res.json({ worlds });
  } catch (err) { next(err); }
});

/** GET /api/worlds/:id — 월드 상세 */
router.get('/:id', async (req, res, next) => {
  try {
    const world = await prisma.world.findUnique({
      where: { id: req.params.id },
      include: { creator: { select: { username: true } } },
    });
    if (!world) return res.status(404).json({ error: { message: '월드를 찾을 수 없습니다.' } });
    if (!world.isPublic) {
      // 비공개는 본인만
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(403).json({ error: { message: '비공개 월드입니다.' } });
    }
    res.json({ world });
  } catch (err) { next(err); }
});

/** POST /api/worlds — 월드 생성 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, description, mapData } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: { message: '이름을 입력하세요.' } });

    await prisma.profile.upsert({
      where:  { id: req.user.id },
      create: { id: req.user.id, username: req.user.nickname || `user_${req.user.id.slice(0,6)}` },
      update: {},
    });

    const world = await prisma.world.create({
      data: {
        creatorId:   req.user.id,
        name:        String(name).trim().slice(0, 100),
        description: description ? String(description).trim().slice(0, 500) : null,
        mapData:     (mapData && typeof mapData === 'object') ? mapData : { objects: [] },
      },
    });
    res.json({ world });
  } catch (err) { next(err); }
});

/** PATCH /api/worlds/:id — 맵 데이터 저장 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const world = await prisma.world.findUnique({ where: { id: req.params.id } });
    if (!world) return res.status(404).json({ error: { message: '월드 없음' } });
    if (world.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    const { name, description, mapData, isPublic, thumbnailUrl } = req.body;
    const data = {};
    if (name !== undefined)         data.name        = String(name).trim().slice(0, 100);
    if (description !== undefined)  data.description = String(description).trim().slice(0, 500);
    if (mapData !== undefined)      data.mapData     = mapData;
    if (isPublic !== undefined)     data.isPublic    = Boolean(isPublic);
    if (thumbnailUrl !== undefined) data.thumbnailUrl = thumbnailUrl;

    const updated = await prisma.world.update({ where: { id: req.params.id }, data });
    res.json({ world: updated });
  } catch (err) { next(err); }
});

/** POST /api/worlds/:id/play — 플레이 카운트 증가 */
router.post('/:id/play', async (req, res, next) => {
  try {
    await prisma.world.update({
      where: { id: req.params.id },
      data:  { playCount: { increment: 1 } },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/** DELETE /api/worlds/:id */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const world = await prisma.world.findUnique({ where: { id: req.params.id } });
    if (!world) return res.status(404).json({ error: { message: '월드 없음' } });
    if (world.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });
    await prisma.world.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
