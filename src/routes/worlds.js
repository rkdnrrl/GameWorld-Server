const { Router } = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');
const r2 = require('../lib/r2');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

const router = Router();

/**
 * GET /api/worlds/public — 공개 월드 목록 + 검색/정렬/태그
 * Query:
 *   q     — 이름/설명 부분 검색 (case-insensitive)
 *   tag   — 태그(해시태그) 필터. 이름/설명에 `#{tag}` 포함된 월드만.
 *   sort  — 'popular' (기본, playCount desc) | 'latest' (createdAt desc) | 'updated' (updatedAt desc) | 'name' (name asc)
 *   limit — 최대 50 (default 50)
 *   offset — pagination
 */
router.get('/public', async (req, res, next) => {
  try {
    const q      = String(req.query.q   || '').trim().slice(0, 60);
    const tag    = String(req.query.tag || '').trim().slice(0, 40).replace(/^#/, '');
    const sort   = String(req.query.sort || 'popular');
    const limit  = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const where = { isPublic: true };
    if (String(req.query.onlyGames || '') === '1') where.isGame = true;   // 게임만 필터
    const AND = [];
    if (q) {
      AND.push({
        OR: [
          { name:        { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (tag) {
      const needle = `#${tag}`;
      AND.push({
        OR: [
          { name:        { contains: needle, mode: 'insensitive' } },
          { description: { contains: needle, mode: 'insensitive' } },
        ],
      });
    }
    if (AND.length) where.AND = AND;

    const orderBy =
      sort === 'latest'  ? { createdAt: 'desc' } :
      sort === 'updated' ? { updatedAt: 'desc' } :
      sort === 'name'    ? { name:      'asc'  } :
                           { playCount: 'desc' }; // popular (default)

    const [worlds, total] = await Promise.all([
      prisma.world.findMany({
        where, orderBy, take: limit, skip: offset,
        select: {
          id: true, name: true, description: true, thumbnailUrl: true,
          playCount: true, isGame: true, createdAt: true, updatedAt: true,
          creator: { select: { username: true } },
        },
      }),
      prisma.world.count({ where }),
    ]);

    res.json({ worlds, total });
  } catch (err) { next(err); }
});

/** GET /api/worlds/my — 내 월드 목록 */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const worlds = await prisma.world.findMany({
      where: { creatorId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      include: { creator: { select: { username: true } } },
    });
    res.json({ worlds });
  } catch (err) { next(err); }
});

/** GET /api/worlds/home-hub — 현재 홈허브 월드 ID (운영자가 설정한 것) */
router.get('/home-hub', async (req, res, next) => {
  try {
    const cfg = await prisma.appConfig.findUnique({ where: { key: 'homeHubWorldId' } });
    res.json({ worldId: cfg?.value || null });
  } catch (err) { next(err); }
});

/**
 * GET /api/worlds/server-owned — 서버 귀속 월드 목록 (wasPublic=true).
 * ⚠️ /:id 보다 위에 와야 함 — Express 가 '/server-owned' 를 :id 로 잡지 않게.
 */
router.get('/server-owned', async (_req, res, next) => {
  try {
    const worlds = await prisma.world.findMany({
      where: { wasPublic: true },
      orderBy: [{ playCount: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
      include: { creator: { select: { username: true } } },
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
    const { name, description, mapData, thumbnailUrl } = req.body;
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
        ...(thumbnailUrl ? { thumbnailUrl: String(thumbnailUrl) } : {}),
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

    const { name, description, mapData, isPublic, thumbnailUrl, gameCharacter, isGame } = req.body;
    const data = {};
    if (isGame !== undefined) data.isGame = Boolean(isGame);
    if (name !== undefined)         data.name        = String(name).trim().slice(0, 100);
    if (description !== undefined)  data.description = String(description).trim().slice(0, 500);
    if (mapData !== undefined)      data.mapData     = mapData;
    if (isPublic !== undefined)     data.isPublic    = Boolean(isPublic);
    if (thumbnailUrl !== undefined) data.thumbnailUrl = thumbnailUrl;
    // 제작자 지정 게임 캐릭터 — appearance JSON 객체이거나 null(본인 캐릭터)
    if (gameCharacter !== undefined) data.gameCharacter = (gameCharacter && typeof gameCharacter === 'object') ? gameCharacter : null;

    const updated = await prisma.world.update({ where: { id: req.params.id }, data });
    res.json({ world: updated });
  } catch (err) { next(err); }
});

/** POST /api/worlds/thumbnail — 썸네일 이미지 업로드 (R2) */
router.post('/thumbnail', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: '파일 없음' } });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const key = `world-thumbnails/${req.user.id}/${id}.webp`;
    await r2.putObject(key, file.buffer, { contentType: 'image/webp' });
    const url = `https://play.airliveplay.com/${key}`;
    res.json({ url });
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
    // 한 번이라도 공개됐던 월드는 운영자만 삭제 가능 (서버 귀속).
    // 한 번도 공개 안 한 월드는 본인만 삭제 가능.
    const isOp = !!req.user.isOperator;
    if (world.wasPublic) {
      if (!isOp) return res.status(403).json({ error: { message: '공개된 적 있는 월드는 운영자만 삭제할 수 있습니다.' } });
    } else if (world.creatorId !== req.user.id) {
      return res.status(403).json({ error: { message: '권한 없음' } });
    }
    await prisma.world.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * GET /api/worlds/server-owned — 서버 귀속(wasPublic=true) 월드 목록.
 * creator 탈퇴해도 살아남는 월드들. 홈허브 후보·운영자 관리 화면용.
 */
module.exports = router;
