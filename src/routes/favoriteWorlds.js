/**
 * 월드 즐겨찾기 (Phase 5-I) — 계정 단위 ★ 동기화 (디바이스 간).
 *   GET    /api/favorite-worlds        — 내 즐겨찾기 목록 (addedAt desc)
 *   POST   /api/favorite-worlds        — 추가/업데이트 (body: { worldId, name, thumbnailUrl })
 *   DELETE /api/favorite-worlds/:id    — 제거
 *   POST   /api/favorite-worlds/sync   — 일괄 merge (로컬 → 서버 push, 첫 로그인 케이스)
 *
 * 최대 100개. 초과 시 가장 오래된 항목 제거.
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();
const MAX = 100;

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const items = await prisma.favoriteWorld.findMany({
      where: { userId: req.user.id },
      orderBy: { addedAt: 'desc' },
      take: MAX,
    });
    res.json({
      favorites: items.map(i => ({
        id: i.worldId,
        name: i.name,
        thumbnailUrl: i.thumbnailUrl,
        addedAt: i.addedAt.getTime(),
      })),
    });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const { worldId, name, thumbnailUrl } = req.body || {};
    if (!worldId || typeof worldId !== 'string') return res.status(400).json({ error: 'worldId required' });
    if (!name    || typeof name    !== 'string') return res.status(400).json({ error: 'name required' });

    await prisma.favoriteWorld.upsert({
      where:  { userId_worldId: { userId: me, worldId } },
      update: { name: name.slice(0, 120), thumbnailUrl: thumbnailUrl?.slice(0, 400) ?? null },
      create: { userId: me, worldId, name: name.slice(0, 120), thumbnailUrl: thumbnailUrl?.slice(0, 400) ?? null },
    });

    // 초과 시 가장 오래된 것 제거
    const count = await prisma.favoriteWorld.count({ where: { userId: me } });
    if (count > MAX) {
      const excess = await prisma.favoriteWorld.findMany({
        where: { userId: me },
        orderBy: { addedAt: 'asc' },
        take: count - MAX,
        select: { worldId: true },
      });
      await prisma.favoriteWorld.deleteMany({
        where: { userId: me, worldId: { in: excess.map(e => e.worldId) } },
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.favoriteWorld.deleteMany({
      where: { userId: req.user.id, worldId: req.params.id },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// 일괄 merge — 로컬 캐시를 서버에 push (첫 로그인 등). 서버에 이미 있으면 유지.
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const { items } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items[] required' });

    const valid = items
      .filter(x => x && typeof x.id === 'string' && typeof x.name === 'string')
      .slice(0, MAX);

    if (valid.length > 0) {
      await Promise.all(valid.map(x =>
        prisma.favoriteWorld.upsert({
          where:  { userId_worldId: { userId: me, worldId: x.id } },
          update: {}, // 이미 있으면 그대로 (서버가 SoT)
          create: {
            userId: me,
            worldId: x.id,
            name: String(x.name).slice(0, 120),
            thumbnailUrl: x.thumbnailUrl ? String(x.thumbnailUrl).slice(0, 400) : null,
            addedAt: typeof x.addedAt === 'number' ? new Date(x.addedAt) : new Date(),
          },
        })
      ));
    }

    // sync 후 최종 목록 반환 (SoT)
    const final = await prisma.favoriteWorld.findMany({
      where: { userId: me },
      orderBy: { addedAt: 'desc' },
      take: MAX,
    });
    res.json({
      favorites: final.map(i => ({
        id: i.worldId,
        name: i.name,
        thumbnailUrl: i.thumbnailUrl,
        addedAt: i.addedAt.getTime(),
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
