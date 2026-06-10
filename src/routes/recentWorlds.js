/**
 * 최근 방문 월드 (Phase 5-K) — 계정 단위 LRU. 디바이스 간 동기화.
 *   GET    /api/recent-worlds        — 내 최근 방문 (visitedAt desc, max 8)
 *   POST   /api/recent-worlds        — 방문 기록 (body: { worldId, name, thumbnailUrl })
 *   DELETE /api/recent-worlds/:id    — 항목 제거 (카드 ✕ 닫기)
 *   POST   /api/recent-worlds/sync   — 로컬 LRU 를 서버에 merge (최신 visitedAt 승)
 *
 * 유저당 최대 8개 — 초과 시 가장 오래된 방문 제거.
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();
const MAX = 8;

function toClient(i) {
  return {
    id: i.worldId,
    name: i.name,
    thumbnailUrl: i.thumbnailUrl,
    visitedAt: i.visitedAt.getTime(),
  };
}

async function trim(userId) {
  const count = await prisma.recentWorld.count({ where: { userId } });
  if (count > MAX) {
    const excess = await prisma.recentWorld.findMany({
      where: { userId },
      orderBy: { visitedAt: 'asc' },
      take: count - MAX,
      select: { worldId: true },
    });
    await prisma.recentWorld.deleteMany({
      where: { userId, worldId: { in: excess.map(e => e.worldId) } },
    });
  }
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const items = await prisma.recentWorld.findMany({
      where: { userId: req.user.id },
      orderBy: { visitedAt: 'desc' },
      take: MAX,
    });
    res.json({ recents: items.map(toClient) });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const { worldId, name, thumbnailUrl } = req.body || {};
    if (!worldId || typeof worldId !== 'string') return res.status(400).json({ error: 'worldId required' });
    if (!name    || typeof name    !== 'string') return res.status(400).json({ error: 'name required' });

    await prisma.recentWorld.upsert({
      where:  { userId_worldId: { userId: me, worldId } },
      update: { name: name.slice(0, 120), thumbnailUrl: thumbnailUrl?.slice(0, 400) ?? null, visitedAt: new Date() },
      create: { userId: me, worldId, name: name.slice(0, 120), thumbnailUrl: thumbnailUrl?.slice(0, 400) ?? null },
    });
    await trim(me);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.recentWorld.deleteMany({
      where: { userId: req.user.id, worldId: req.params.id },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// 로컬 LRU 를 서버에 merge — 항목별로 더 최신인 visitedAt 이 이김.
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;
    const { items } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items[] required' });

    const valid = items
      .filter(x => x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.visitedAt === 'number')
      .slice(0, MAX);

    if (valid.length > 0) {
      const existing = await prisma.recentWorld.findMany({
        where: { userId: me, worldId: { in: valid.map(x => x.id) } },
        select: { worldId: true, visitedAt: true },
      });
      const existingAt = new Map(existing.map(e => [e.worldId, e.visitedAt.getTime()]));
      await Promise.all(valid.map(x => {
        const prev = existingAt.get(x.id);
        if (prev !== undefined && prev >= x.visitedAt) return null; // 서버가 더 최신
        return prisma.recentWorld.upsert({
          where:  { userId_worldId: { userId: me, worldId: x.id } },
          update: { visitedAt: new Date(x.visitedAt) },
          create: {
            userId: me,
            worldId: x.id,
            name: String(x.name).slice(0, 120),
            thumbnailUrl: x.thumbnailUrl ? String(x.thumbnailUrl).slice(0, 400) : null,
            visitedAt: new Date(x.visitedAt),
          },
        });
      }));
      await trim(me);
    }

    const final = await prisma.recentWorld.findMany({
      where: { userId: me },
      orderBy: { visitedAt: 'desc' },
      take: MAX,
    });
    res.json({ recents: final.map(toClient) });
  } catch (err) { next(err); }
});

module.exports = router;
