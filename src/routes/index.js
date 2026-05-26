const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const gamesUploadRoutes = require('./gamesUpload');
const genreRoutes = require('./genres');
const categoryRoutes = require('./categories');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.use('/auth',       require('./auth'));
router.use('/characters', require('./characters'));
router.use('/worlds',     require('./worlds'));
router.use('/assets',                require('./assets'));
router.use('/asset-kinds',           require('./asset-kinds'));
router.use('/users',                 require('./users'));
router.use('/notifications',         require('./notifications'));
router.use('/packs',                 require('./packs'));
router.use('/operator/asset-reports', require('./asset-reports'));
router.use('/games',                 require('./games'));
router.use('/games',                 gamesUploadRoutes.router);
router.use('/operator/games',        gamesUploadRoutes.operatorRouter);
router.use('/announcements',         require('./announcements'));
router.use('/community',             require('./community'));
router.use('/genres',                genreRoutes.router);
router.use('/operator/genres',       genreRoutes.operatorRouter);
router.use('/categories',            categoryRoutes.router);
router.use('/operator/categories',   categoryRoutes.operatorRouter);

/** GET /api/me — 현재 유저 정보 */
router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, nickname: u.nickname, name: u.nickname });
});

module.exports = router;
