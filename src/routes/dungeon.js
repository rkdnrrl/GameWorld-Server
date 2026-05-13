const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

router.get('/save', requireAuth, async (req, res, next) => {
  try {
    const row = await prisma.dungeonSave.findUnique({ where: { userId: req.user.id } });
    res.json({ save: row ? row.data : null });
  } catch (err) {
    next(err);
  }
});

router.post('/save', requireAuth, async (req, res, next) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: { message: 'data required' } });
    const row = await prisma.dungeonSave.upsert({
      where:  { userId: req.user.id },
      update: { data },
      create: { userId: req.user.id, data },
    });
    res.json({ ok: true, savedAt: row.savedAt });
  } catch (err) {
    next(err);
  }
});

router.delete('/save', requireAuth, async (req, res, next) => {
  try {
    await prisma.dungeonSave.deleteMany({ where: { userId: req.user.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
