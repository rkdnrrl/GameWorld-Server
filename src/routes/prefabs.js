/**
 * 프리팹 (Unity 스타일 오브젝트 스냅샷) CRUD.
 * V1: 인스턴스는 독립 복사본 (링크 없음). isPublic/importCount 는 V2 마켓플레이스용 자리.
 */
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

/** GET /api/prefabs/my — 본인 프리팹 목록 */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const prefabs = await prisma.prefab.findMany({
      where: { creatorId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, name: true, thumbnailUrl: true, payload: true,
        isPublic: true, createdAt: true, updatedAt: true,
      },
    });
    res.json({ prefabs });
  } catch (err) { next(err); }
});

/** POST /api/prefabs — 새 프리팹 저장.
 *  body: { name: string, payload: object, thumbnailUrl?: string } */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, payload, thumbnailUrl } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: { message: '이름이 필요합니다.' } });
    }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: { message: 'payload 가 잘못되었습니다.' } });
    }
    const prefab = await prisma.prefab.create({
      data: {
        creatorId: req.user.id,
        name: String(name).trim().slice(0, 100),
        payload,
        thumbnailUrl: thumbnailUrl ? String(thumbnailUrl).slice(0, 400) : null,
      },
    });
    res.json({ prefab });
  } catch (err) { next(err); }
});

/** PATCH /api/prefabs/:id — 이름/payload/thumbnail 수정 (본인 것만) */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.prefab.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: '프리팹 없음' } });
    if (existing.creatorId !== req.user.id) {
      return res.status(403).json({ error: { message: '권한 없음' } });
    }
    const { name, payload, thumbnailUrl } = req.body ?? {};
    const data = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim().slice(0, 100);
    if (payload && typeof payload === 'object') data.payload = payload;
    if (thumbnailUrl !== undefined) {
      data.thumbnailUrl = thumbnailUrl ? String(thumbnailUrl).slice(0, 400) : null;
    }
    const prefab = await prisma.prefab.update({ where: { id: req.params.id }, data });
    res.json({ prefab });
  } catch (err) { next(err); }
});

/** DELETE /api/prefabs/:id — 본인 것만 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.prefab.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: '프리팹 없음' } });
    if (existing.creatorId !== req.user.id) {
      return res.status(403).json({ error: { message: '권한 없음' } });
    }
    await prisma.prefab.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
