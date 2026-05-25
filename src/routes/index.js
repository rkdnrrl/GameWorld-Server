const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.use('/auth',       require('./auth'));
router.use('/characters', require('./characters'));
router.use('/worlds',     require('./worlds'));
router.use('/assets',      require('./assets'));
router.use('/asset-kinds', require('./asset-kinds'));

/** GET /api/me — 현재 유저 정보 */
router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, nickname: u.nickname, name: u.nickname });
});

module.exports = router;
