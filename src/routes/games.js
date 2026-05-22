const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();
const STATIC_GAMES = require('../config/games');

/**
 * 실시간 접속자 수 fetch (statusUrl 있는 게임만)
 */
async function fetchStatus(statusUrl) {
  if (!statusUrl) return { players: null, rooms: null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const r = await fetch(statusUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return { players: null, rooms: null };
    const status = await r.json();
    return {
      players: status.totalConnections ?? status.totalPlayers ?? 0,
      rooms: status.totalRooms ?? 0,
    };
  } catch {
    return { players: null, rooms: null };
  }
}

/**
 * GET /api/games
 *   - DB 의 published 게임 (official + community 모두) 반환
 *   - STATIC_GAMES 는 옛 Lightsail 폐기에 맞춰 비워둠 — 코드 폴백용으로만 합쳐줌
 *   - 각 게임의 statusUrl 로 실시간 접속자 수 가져옴
 */
router.get('/', async (req, res, next) => {
  try {
    // 옛 정적 config (보통 빈 배열)
    const staticGames = STATIC_GAMES.map((g) => ({ ...g, kind: 'official' }));

    // 게임별 평점 집계
    let ratingMap = new Map();
    try {
      const ratings = await prisma.gameRating.groupBy({
        by: ['gameSlug'],
        _avg: { rating: true },
        _count: { rating: true },
      });
      for (const r of ratings) {
        ratingMap.set(r.gameSlug, {
          avg:   Math.round((r._avg.rating ?? 0) * 10) / 10,
          count: r._count.rating,
        });
      }
    } catch {}

    // DB 의 published 게임 (official + community 둘 다)
    let dbGames = [];
    try {
      const rows = await prisma.game.findMany({
        where: { status: 'published' },
        orderBy: [{ kind: 'asc' }, { publishedAt: 'desc' }],
        select: {
          slug: true, title: true, description: true, emoji: true, category: true,
          kind: true, tags: true, thumbnailUrl: true, externalUrl: true,
          playCount: true, likeCount: true, statusUrl: true, maxPlayers: true, isFeatured: true,
        },
      });
      dbGames = rows.map((g) => {
        // 옛 13.125 Lightsail URL 은 무시하고 play.airliveplay.com 으로 강제 (인스턴스 폐기됨)
        const ext = g.externalUrl && !/13\.125\.187\.132/.test(g.externalUrl) ? g.externalUrl : null;
        return {
          id: g.slug,
          title: g.title,
          description: g.description || '',
          url: ext || `https://play.airliveplay.com/${g.slug}/`,
          emoji: g.emoji,
          tags: Array.isArray(g.tags) ? g.tags : [],
          category: g.category,
          kind: g.kind,
          thumbnailUrl: g.thumbnailUrl || null,
          maxPlayers: g.maxPlayers ?? null,
          players: null,
          rooms: null,
          playCount:   g.playCount,
          likeCount:   g.likeCount,
          ratingAvg:   ratingMap.get(g.slug)?.avg   ?? null,
          ratingCount: ratingMap.get(g.slug)?.count ?? 0,
          isFeatured:  !!g.isFeatured,
          statusUrl: g.statusUrl || undefined,
        };
      });
    } catch (err) {
      console.error('games DB query failed:', err.message);
    }

    // 실시간 접속자 수 (statusUrl 있는 것만)
    const gamesWithStatus = await Promise.all(
      [...staticGames, ...dbGames].map(async (g) => {
        const { statusUrl, ...info } = g;
        if (!statusUrl) {
          return { ...info, players: info.players ?? null, rooms: info.rooms ?? null };
        }
        const s = await fetchStatus(statusUrl);
        return { ...info, ...s };
      }),
    );

    res.json({ games: gamesWithStatus });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/games/:slug/rate  (auth required)
 *   body: { rating: 1-5 }
 *   → upsert 후 갱신된 avg/count 반환
 */
router.post('/:slug/rate', requireAuth, async (req, res, next) => {
  const slug   = String(req.params.slug || '').trim().toLowerCase();
  const rating = Number(req.body.rating);
  const userId = req.user.id;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be 1–5' });
  }

  try {
    await prisma.gameRating.upsert({
      where:  { userId_gameSlug: { userId, gameSlug: slug } },
      update: { rating },
      create: { userId, gameSlug: slug, rating },
    });

    const agg = await prisma.gameRating.aggregate({
      where: { gameSlug: slug },
      _avg:   { rating: true },
      _count: { rating: true },
    });

    res.json({
      avg:   Math.round((agg._avg.rating ?? 0) * 10) / 10,
      count: agg._count.rating,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/games/:slug/comments
 */
router.get('/:slug/comments', async (req, res, next) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  try {
    const rows = await prisma.gameComment.findMany({
      where:   { gameSlug: slug },
      orderBy: { createdAt: 'desc' },
      take:    100,
      select:  { id: true, userId: true, nickname: true, content: true, createdAt: true },
    });
    res.json({ comments: rows });
  } catch (err) { next(err); }
});

/**
 * POST /api/games/:slug/comments  (auth required)
 *   body: { content }
 */
router.post('/:slug/comments', requireAuth, async (req, res, next) => {
  const slug    = String(req.params.slug || '').trim().toLowerCase();
  const content = String(req.body.content || '').trim();
  const userId  = req.user.id;

  if (!content || content.length > 500) {
    return res.status(400).json({ error: '댓글은 1~500자 이내여야 합니다.' });
  }

  try {
    // 닉네임 조회
    const user     = await prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } });
    const nickname = user?.nickname ?? '익명';

    const comment = await prisma.gameComment.create({
      data:   { userId, gameSlug: slug, nickname, content },
      select: { id: true, userId: true, nickname: true, content: true, createdAt: true },
    });
    res.status(201).json({ comment });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/games/:slug/comments/:id  (owner 또는 operator)
 */
router.delete('/:slug/comments/:id', requireAuth, async (req, res, next) => {
  const id     = BigInt(req.params.id || '0');
  const userId = req.user.id;

  try {
    const row = await prisma.gameComment.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
    if (row.userId !== userId && !req.user.isOperator) {
      return res.status(403).json({ error: '권한이 없습니다.' });
    }
    await prisma.gameComment.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * GET /api/games/:slug
 *   - 단일 게임 상세 (community 게임 페이지에서 사용)
 *   - 운영자는 status 무관하게 조회 가능 (TODO)
 */
router.get('/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: { message: '잘못된 slug 입니다.' } });
    }

    // DB 우선 조회
    const g = await prisma.game.findUnique({ where: { slug } });
    if (g && g.status === 'published') {
      return res.json({
        game: {
          id: g.slug,
          slug: g.slug,
          title: g.title,
          description: g.description,
          emoji: g.emoji,
          kind: g.kind,
          category: g.category,
          tags: Array.isArray(g.tags) ? g.tags : [],
          thumbnailUrl: g.thumbnailUrl,
          demoVideoUrl: g.demoVideoUrl ?? null,
          screenshots: Array.isArray(g.screenshots) ? g.screenshots : [],
          playCount: g.playCount,
          likeCount: g.likeCount,
          version: g.version,
          url: (g.externalUrl && !/13\.125\.187\.132/.test(g.externalUrl) ? g.externalUrl : null) || `https://play.airliveplay.com/${g.slug}/`,
          publishedAt: g.publishedAt,
        },
      });
    }

    // 정적 폴백
    const staticGame = STATIC_GAMES.find((x) => x.id === slug);
    if (staticGame) {
      return res.json({
        game: { ...staticGame, slug, kind: 'official', screenshots: [] },
      });
    }

    res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
