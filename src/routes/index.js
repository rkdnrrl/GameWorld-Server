const { Router } = require('express');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.use('/auth', require('./auth'));
router.use('/games', require('./games'));
router.use('/coins', require('./coins'));
router.use('/catches', require('./catches'));
router.use('/craft', require('./craft'));
router.use('/smelt', require('./smelt'));
router.use('/furniture', require('./furniture'));
router.use('/voxels', require('./voxels'));
router.use('/ai', require('./ai'));

module.exports = router;
