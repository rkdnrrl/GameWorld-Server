const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

/** GET /api/characters/me — 내 캐릭터 조회 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const char = await prisma.character.findUnique({
      where: { userId: req.user.id },
    });
    res.json({ character: char });
  } catch (err) { next(err); }
});

/** POST /api/characters — 캐릭터 생성/교체 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, appearance } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: { message: '이름을 입력해주세요.' } });

    // 프로필이 없으면 자동 생성
    await prisma.profile.upsert({
      where: { id: req.user.id },
      create: { id: req.user.id, username: req.user.nickname || `user_${req.user.id.slice(0, 6)}` },
      update: {},
    });

    const char = await prisma.character.upsert({
      where: { userId: req.user.id },
      create: {
        userId:     req.user.id,
        name:       String(name).trim().slice(0, 30),
        appearance: appearance || {},
      },
      update: {
        name:       String(name).trim().slice(0, 30),
        appearance: appearance || {},
      },
    });

    res.json({ character: char });
  } catch (err) { next(err); }
});

/** PATCH /api/characters/me — 외형 업데이트 */
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { name, appearance } = req.body;
    const data = {};
    if (name)       data.name       = String(name).trim().slice(0, 30);
    if (appearance) data.appearance = appearance;

    const char = await prisma.character.update({
      where: { userId: req.user.id },
      data,
    });
    res.json({ character: char });
  } catch (err) { next(err); }
});

module.exports = router;
