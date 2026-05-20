const { Router } = require('express');
const { prisma } = require('../db');

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
 *   - 정적 config 의 공식(official) 게임 + DB 의 published community 게임 합쳐 반환
 *   - 각 게임의 statusUrl 로 실시간 접속자 수 가져옴
 */
router.get('/', async (req, res, next) => {
  try {
    // 1) 정적 official 게임 (기존 routes/games.js 동작 유지)
    const staticGames = STATIC_GAMES.map((g) => ({ ...g, kind: 'official' }));

    // 2) DB 의 community 게임 — published 만 노출
    let communityGames = [];
    try {
      const dbCommunity = await prisma.game.findMany({
        where: { kind: 'community', status: 'published' },
        orderBy: { publishedAt: 'desc' },
        select: {
          slug: true, title: true, description: true, emoji: true, category: true,
          tags: true, thumbnailUrl: true, playCount: true, likeCount: true,
        },
      });
      communityGames = dbCommunity.map((g) => ({
        id: g.slug,
        title: g.title,
        description: g.description || '',
        url: `https://play.airliveplay.com/${g.slug}/`,
        emoji: g.emoji,
        tags: Array.isArray(g.tags) ? g.tags : [],
        category: g.category,
        kind: 'community',
        thumbnailUrl: g.thumbnailUrl || null,
        maxPlayers: null,
        players: null,
        rooms: null,
        playCount: g.playCount,
        likeCount: g.likeCount,
      }));
    } catch (err) {
      // DB 조회 실패해도 정적 게임은 노출 (그라데이션 폴백)
      console.error('community games DB query failed:', err.message);
    }

    // 3) 실시간 접속자 수 (statusUrl 있는 것만)
    const gamesWithStatus = await Promise.all(
      [...staticGames, ...communityGames].map(async (g) => {
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
          url: g.externalUrl || `https://play.airliveplay.com/${g.slug}/`,
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
