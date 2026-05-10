const GAMES = [
  {
    id: 'cube-multiplay',
    title: '큐브 멀티플레이',
    description: '친구들과 함께 즐기는 실시간 멀티플레이 큐브 게임',
    url: process.env.CUBE_GAME_URL || 'http://13.125.187.132/multiplay-game1',
    statusUrl: process.env.CUBE_GAME_STATUS_URL || 'http://13.125.187.132/status',
    emoji: '🎲',
    tags: ['멀티플레이', '실시간'],
  },
  {
    id: 'topdown-multiplay',
    title: '탑다운 멀티플레이',
    description: '친구들과 함께 즐기는 탑다운 시점 멀티플레이 게임',
    url: process.env.TOPDOWN_GAME_URL || 'http://13.125.187.132/multiplay-game2',
    statusUrl: process.env.TOPDOWN_GAME_STATUS_URL || 'http://13.125.187.132/multiplay-game2/status',
    emoji: '🎮',
    tags: ['멀티플레이', '실시간'],
  },
  {
    id: 'rock-clicker',
    title: '돌깨기 클리커',
    description: '바위를 연타해서 부수고 게임머니를 모으세요!',
    url: process.env.ROCK_CLICKER_URL || 'http://13.125.187.132/rock-clicker',
    // 싱글플레이 — statusUrl 없음
    emoji: '🪨',
    tags: ['싱글플레이', '클리커'],
  },
];

module.exports = GAMES;
