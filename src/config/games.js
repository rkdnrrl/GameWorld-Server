/**
 * 게임 종류 (플랫폼 목록에서 섹션으로 묶음)
 * - earn: 코인/재화를 모으는 싱글 등
 * - multiplay: 실시간 멀티플레이
 * - decorate: 인테리어·꾸미기 등
 */
const GAMES = [
  {
    id: 'space-fishing',
    title: '우주 낚시',
    description: '우주 공간에서 희귀한 생명체와 유물을 낚아보세요!',
    url: process.env.SPACE_FISHING_URL || 'http://13.125.187.132/space-fishing',
    // 싱글플레이 — statusUrl 없음
    emoji: '🎣',
    tags: ['싱글플레이', '낚시'],
    category: 'earn',
  },
  /** 레포: `Singleplay-Game5` — 중세 대장간 톤 · nginx 예: `location /singleplay-game5/` */
  {
    id: 'blacksmith',
    title: '대장간',
    description: '모루와 불길 앞에서 재료를 맞물려, 장비를 제련하세요.',
    url:
      process.env.SINGLEPLAY_GAME5_URL ||
      process.env.BLACKSMITH_URL ||
      'http://13.125.187.132/singleplay-game5',
    emoji: '⚒️',
    tags: ['싱글플레이', '조합', '제작', '중세'],
    category: 'earn',
  },
  {
    id: 'cube-multiplay',
    title: '큐브 멀티플레이',
    description: '친구들과 함께 즐기는 실시간 멀티플레이 큐브 게임',
    url: process.env.CUBE_GAME_URL || 'http://13.125.187.132/multiplay-game1',
    statusUrl: process.env.CUBE_GAME_STATUS_URL || 'http://13.125.187.132/status',
    emoji: '🎲',
    maxPlayers: 100,
    tags: ['멀티플레이', '실시간'],
    category: 'multiplay',
  },
  {
    id: 'topdown-multiplay',
    title: '탑다운 멀티플레이',
    description: '친구들과 함께 즐기는 탑다운 시점 멀티플레이 게임',
    url: process.env.TOPDOWN_GAME_URL || 'http://13.125.187.132/multiplay-game2',
    statusUrl: process.env.TOPDOWN_GAME_STATUS_URL || 'http://13.125.187.132/multiplay-game2/status',
    emoji: '🎮',
    maxPlayers: 100,
    tags: ['멀티플레이', '실시간'],
    category: 'multiplay',
  },
  {
    id: 'interior-3d',
    title: '3D 인테리어 방',
    description: '가구를 사서 방을 3D로 꾸며 보세요.',
    url: process.env.INTERIOR_3D_URL || 'http://13.125.187.132/interior1',
    emoji: '🏠',
    tags: ['싱글플레이', '꾸미기'],
    category: 'decorate',
  },
];

module.exports = GAMES;
