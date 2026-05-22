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

    // DB 의 published 게임 (official + community 둘 다)
    let dbGames = [];
    try {
      const rows = await prisma.game.findMany({
        where: { status: 'published' },
        orderBy: [{ kind: 'asc' }, { publishedAt: 'desc' }],
        select: {
          slug: true, title: true, description: true, emoji: true, category: true,
          kind: true, tags: true, thumbnailUrl: true, externalUrl: true,
          playCount: true, likeCount: true, statusUrl: true, maxPlayers: true,
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
          playCount: g.playCount,
          likeCount: g.likeCount,
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
