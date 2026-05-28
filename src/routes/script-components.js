/**
 * 유저 정의 스크립트 컴포넌트 CRUD.
 * 부착되는 인스턴스 (ComponentInstance) 는 오브젝트의 components 배열에
 * { type: `user:<id>`, props: {...} } 형태로 저장됨 (Prefab/World mapData 안).
 */
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

/** GET /api/script-components/my — 본인 스크립트 컴포넌트 목록 */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const components = await prisma.scriptComponent.findMany({
      where: { creatorId: req.user.id },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ components });
  } catch (err) { next(err); }
});

/** GET /api/script-components/by-ids?ids=a,b,c — 특정 id 들 한번에 가져오기 (월드 런타임용).
 *  본인 것이 아니어도 (= 다른 사람 공유 컴포넌트) 접근 가능하게 추후 확장 가능. V1 은 자기 것만. */
router.get('/by-ids', requireAuth, async (req, res, next) => {
  try {
    const idsRaw = String(req.query.ids || '');
    const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
    if (ids.length === 0) return res.json({ components: [] });
    const components = await prisma.scriptComponent.findMany({
      where: { id: { in: ids }, creatorId: req.user.id },
    });
    res.json({ components });
  } catch (err) { next(err); }
});

/** POST /api/script-components — 새 컴포넌트 생성.
 *  body: { name, icon?, description?, code } */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, icon, description, code } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: { message: '이름이 필요합니다.' } });
    }
    if (typeof code !== 'string') {
      return res.status(400).json({ error: { message: '코드가 필요합니다.' } });
    }
    const component = await prisma.scriptComponent.create({
      data: {
        creatorId: req.user.id,
        name: name.trim().slice(0, 60),
        icon: icon ? String(icon).slice(0, 8) : null,
        description: description ? String(description).slice(0, 300) : null,
        code: String(code),
      },
    });
    res.json({ component });
  } catch (err) { next(err); }
});

/** PATCH /api/script-components/:id — 수정 (본인 것만) */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.scriptComponent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: '컴포넌트 없음' } });
    if (existing.creatorId !== req.user.id) {
      return res.status(403).json({ error: { message: '권한 없음' } });
    }
    const { name, icon, description, code } = req.body ?? {};
    const data = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim().slice(0, 60);
    if (icon !== undefined) data.icon = icon ? String(icon).slice(0, 8) : null;
    if (description !== undefined) data.description = description ? String(description).slice(0, 300) : null;
    if (typeof code === 'string') data.code = code;
    const component = await prisma.scriptComponent.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ component });
  } catch (err) { next(err); }
});

/** DELETE /api/script-components/:id */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.scriptComponent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: '컴포넌트 없음' } });
    if (existing.creatorId !== req.user.id) {
      return res.status(403).json({ error: { message: '권한 없음' } });
    }
    await prisma.scriptComponent.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
