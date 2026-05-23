const { Router } = require('express');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.use('/auth', require('./auth'));
// 서비스 간 webhook (X-Internal-Secret 인증)
router.use('/internal', require('./internal'));
// UGC 업로드 + 모더레이션 라우트 (mount 순서 중요: 일반 /games 보다 먼저 등록되도록 분리)
const gamesUpload = require('./gamesUpload');
router.use('/games', gamesUpload.router);
router.use('/operator/games', gamesUpload.operatorRouter);
const categories = require('./categories');
router.use('/categories', categories.router);
router.use('/operator/categories', categories.operatorRouter);
router.use('/games', require('./games'));
router.use('/coins', require('./coins'));
router.use('/alp-coins', require('./alpCoins'));
router.use('/seafood-market', require('./seafoodMarket'));
router.use('/inventory', require('./inventory'));
router.use('/game-state', require('./gameState'));
router.use('/catches', require('./catches'));
router.use('/craft', require('./craft'));
router.use('/alchemy', require('./alchemy'));
router.use('/smelt', require('./smelt'));
router.use('/furniture', require('./furniture'));
router.use('/voxels', require('./voxels'));
router.use('/ai', require('./ai'));
router.use('/operator', require('./operator'));
router.use('/dungeon', require('./dungeon'));
router.use('/modules', require('./modules'));
router.use('/donate', require('./donate'));
router.use('/announcements', require('./announcements'));
router.use('/community', require('./community'));
router.use('/shop', require('./shop'));
router.use('/leaderboard', require('./leaderboard'));
router.use('/missions', require('./missions'));
router.use('/ads', require('./ads'));

module.exports = router;
