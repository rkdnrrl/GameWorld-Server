const { Router } = require('express');

const router = Router();
const GAMES = require('../config/games');

// 게임 목록 + 실시간 접속자 수 반환
router.get('/', async (req, res, next) => {
  try {
    const gamesWithStatus = await Promise.all(
      GAMES.map(async (game) => {
        const { statusUrl, ...gameInfo } = game;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          const r = await fetch(statusUrl, { signal: controller.signal });
          clearTimeout(timer);
          const status = await r.json();
          // totalConnections = 로비 + 게임 중 전체 접속자
          const players = status.totalConnections ?? status.totalPlayers ?? 0;
          return { ...gameInfo, players, rooms: status.totalRooms ?? 0 };
        } catch {
          // 게임 서버 응답 없으면 null 반환
          return { ...gameInfo, players: null, rooms: null };
        }
      })
    );
    res.json({ games: gamesWithStatus });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
