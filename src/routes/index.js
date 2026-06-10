const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const gamesUploadRoutes = require('./gamesUpload');
const genreRoutes = require('./genres');
const categoryRoutes = require('./categories');
const characterAnimationRoutes = require('./character-animations');

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
router.use('/friends',               require('./friends'));
router.use('/activity',              require('./activity'));
router.use('/dm',                    require('./dm'));
router.use('/voice',                 require('./voice'));
router.use('/user/api-keys',         require('./userApiKeys'));
const supportersRoutes = require('./supporters');
router.use('/supporters',                supportersRoutes);
router.use('/operator/supporters',       supportersRoutes.operatorRouter);
const redemptionRoutes = require('./redemption');
router.use('/redemption',                redemptionRoutes);
router.use('/operator/redemption-codes', redemptionRoutes.operatorRouter);
router.use('/packs',                 require('./packs'));
router.use('/prefabs',               require('./prefabs'));
const scriptComponentsRoutes = require('./script-components');
router.use('/script-components',          scriptComponentsRoutes.router);
router.use('/operator/script-components', scriptComponentsRoutes.operatorRouter);
router.use('/operator/asset-reports', require('./asset-reports'));
const reportsRoutes = require('./reports');
router.use('/reports',                reportsRoutes);
router.use('/operator/user-reports',  reportsRoutes.operatorRouter);
const feedbackRoutes = require('./feedback');
router.use('/feedback',               feedbackRoutes);
router.use('/operator/feedback',      feedbackRoutes.operatorRouter);
router.use('/attendance',             require('./attendance'));
router.use('/shop',                   require('./shop'));
router.use('/operator/home-hub',     require('./home-hub'));
const siteConfigRoutes = require('./site-config');
router.use('/site-config',           siteConfigRoutes);
router.use('/operator/site-config',  siteConfigRoutes.operatorRouter);
router.use('/operators',             require('./operators'));
router.use('/games',                 gamesUploadRoutes.router);
router.use('/games',                 require('./games'));
router.use('/operator/games',        gamesUploadRoutes.operatorRouter);
router.use('/announcements',         require('./announcements'));
router.use('/community',             require('./community'));
router.use('/world-data',            require('./worldData'));
router.use('/genres',                genreRoutes.router);
router.use('/operator/genres',       genreRoutes.operatorRouter);
router.use('/categories',            categoryRoutes.router);
router.use('/operator/categories',   categoryRoutes.operatorRouter);
router.use('/character-animations',  characterAnimationRoutes.router);
router.use('/operator/character-animations', characterAnimationRoutes.operatorRouter);
router.use('/characters/auto-rig',   require('./auto-rig'));

/** GET /api/me — 현재 유저 정보 */
router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, nickname: u.nickname, name: u.nickname });
});

module.exports = router;
