const GAMES = [
  {
    id: 'cube-multiplay',
    title: '큐브 멀티플레이',
    description: '친구들과 함께 즐기는 실시간 멀티플레이 큐브 게임',
    url: process.env.CUBE_GAME_URL || 'http://13.125.187.132:3001',
    statusUrl: process.env.CUBE_GAME_STATUS_URL || 'http://13.125.187.132:3001/status',
    emoji: '🎲',
    tags: ['멀티플레이', '실시간'],
  },
];

module.exports = GAMES;
