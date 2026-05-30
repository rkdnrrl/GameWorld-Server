/**
 * 유저 정의 스크립트 컴포넌트 CRUD.
 *
 * 3-tier:
 *   - 빌트인 (코드 하드코딩) — Grab, AutoRotate
 *   - 공식 (operator 만 isOfficial=true 로 만듦) — 모든 유저 접근
 *   - 내 컴포넌트 (일반 유저) — 본인만
 *
 * 부착되는 인스턴스 (ComponentInstance) 는 오브젝트의 components 배열에
 * { type: `user:<id>`, props: {...} } 형태로 저장됨.
 */
const { Router } = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();

/** GET /api/script-components/official — 공식 컴포넌트 목록 (공개, 비로그인 OK) */
router.get('/official', optionalAuth, async (req, res, next) => {
  try {
    const components = await prisma.scriptComponent.findMany({
      where: { isOfficial: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ components });
  } catch (err) { next(err); }
});

/** GET /api/script-components/my — 본인 스크립트 컴포넌트 목록 (공식 제외) */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const components = await prisma.scriptComponent.findMany({
      where: { creatorId: req.user.id, isOfficial: false },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ components });
  } catch (err) { next(err); }
});

/** GET /api/script-components/by-ids?ids=a,b,c — 월드 런타임용 일괄 fetch.
 *  맵(월드)에 실제로 쓰인 컴포넌트는 누가 만들었든 코드가 있어야 다른 플레이어 화면에서도 실행됨.
 *  → ID 로 조회 허용 (ID 는 추측 불가한 cuid 라 접근 가능한 월드 데이터에서만 얻음). */
router.get('/by-ids', optionalAuth, async (req, res, next) => {
  try {
    const idsRaw = String(req.query.ids || '');
    const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
    if (ids.length === 0) return res.json({ components: [] });
    const components = await prisma.scriptComponent.findMany({
      where: { id: { in: ids } },
    });
    res.json({ components });
  } catch (err) { next(err); }
});

/** POST /api/script-components — 일반 유저: 본인 컴포넌트 생성 (isOfficial 무시) */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, icon, description, code, propsSchema } = req.body ?? {};
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
        propsSchema: Array.isArray(propsSchema) ? propsSchema : [],
        isOfficial: false,  // 일반 유저는 항상 false
      },
    });
    res.json({ component });
  } catch (err) { next(err); }
});

/** PATCH /api/script-components/:id — 본인 것만 수정. isOfficial 은 운영자 전용. */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.scriptComponent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: '컴포넌트 없음' } });
    if (existing.creatorId !== req.user.id) {
      return res.status(403).json({ error: { message: '권한 없음' } });
    }
    const { name, icon, description, code, propsSchema } = req.body ?? {};
    const data = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim().slice(0, 60);
    if (icon !== undefined) data.icon = icon ? String(icon).slice(0, 8) : null;
    if (description !== undefined) data.description = description ? String(description).slice(0, 300) : null;
    if (typeof code === 'string') data.code = code;
    if (Array.isArray(propsSchema)) data.propsSchema = propsSchema;
    // isOfficial 은 여기서 못 바꿈 — 운영자 라우트 사용
    const component = await prisma.scriptComponent.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ component });
  } catch (err) { next(err); }
});

/** DELETE /api/script-components/:id — 본인 것만. 공식 컴포넌트는 운영자가 운영자 라우트로 삭제. */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.scriptComponent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: '컴포넌트 없음' } });
    if (existing.creatorId !== req.user.id) {
      return res.status(403).json({ error: { message: '권한 없음' } });
    }
    if (existing.isOfficial) {
      return res.status(403).json({ error: { message: '공식 컴포넌트는 운영자 페이지에서 삭제하세요.' } });
    }
    await prisma.scriptComponent.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────
// 운영자 전용 라우트 (별도 마운트: /api/operator/script-components)
// ────────────────────────────────────────────────────────────────────
const operatorRouter = Router();

/** GET /api/operator/script-components — 모든 컴포넌트 (공식 + 모든 유저 것) */
operatorRouter.get('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const components = await prisma.scriptComponent.findMany({
      orderBy: [{ isOfficial: 'desc' }, { updatedAt: 'desc' }],
      include: { creator: { select: { username: true } } },
    });
    res.json({ components });
  } catch (err) { next(err); }
});

/** POST /api/operator/script-components — 운영자가 만든 공식 컴포넌트 (자동 isOfficial=true) */
operatorRouter.post('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { name, icon, description, code, isOfficial, propsSchema } = req.body ?? {};
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
        propsSchema: Array.isArray(propsSchema) ? propsSchema : [],
        isOfficial: isOfficial !== false,  // 기본 true (운영자가 만들면 보통 공식)
      },
    });
    res.json({ component });
  } catch (err) { next(err); }
});

/** PATCH /api/operator/script-components/:id — 운영자는 모든 컴포넌트 수정 가능 (isOfficial 포함) */
operatorRouter.patch('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const existing = await prisma.scriptComponent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: '컴포넌트 없음' } });
    const { name, icon, description, code, isOfficial, propsSchema } = req.body ?? {};
    const data = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim().slice(0, 60);
    if (icon !== undefined) data.icon = icon ? String(icon).slice(0, 8) : null;
    if (description !== undefined) data.description = description ? String(description).slice(0, 300) : null;
    if (typeof code === 'string') data.code = code;
    if (typeof isOfficial === 'boolean') data.isOfficial = isOfficial;
    if (Array.isArray(propsSchema)) data.propsSchema = propsSchema;
    const component = await prisma.scriptComponent.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ component });
  } catch (err) { next(err); }
});

/** DELETE /api/operator/script-components/:id — 운영자는 모든 것 삭제 가능 */
operatorRouter.delete('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const existing = await prisma.scriptComponent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { message: '컴포넌트 없음' } });
    await prisma.scriptComponent.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router, operatorRouter };
