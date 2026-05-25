const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

function trimmedName(raw) {
  return String(raw || '').trim().slice(0, 30);
}

/** GET /api/characters — 내 캐릭터 목록 + 활성 캐릭터 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const characters = await prisma.character.findMany({
      where: { userId: req.user.id },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });
    const activeCharacter = characters.find((c) => c.isActive) || null;
    res.json({ characters, activeCharacter });
  } catch (err) { next(err); }
});

/** GET /api/characters/me — 활성 캐릭터 조회 (world 진입 시 사용) */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const char = await prisma.character.findFirst({
      where: { userId: req.user.id, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ character: char || null });
  } catch (err) { next(err); }
});

/** POST /api/characters — 캐릭터 생성 + 활성화 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, appearance } = req.body || {};
    const nm = trimmedName(name);
    if (!nm) return res.status(400).json({ error: { message: '이름을 입력해주세요.' } });

    await prisma.profile.upsert({
      where: { id: req.user.id },
      create: { id: req.user.id, username: req.user.nickname || `user_${req.user.id.slice(0, 6)}` },
      update: {},
    });

    const created = await prisma.$transaction(async (tx) => {
      await tx.character.updateMany({
        where: { userId: req.user.id, isActive: true },
        data: { isActive: false },
      });
      return tx.character.create({
        data: {
          userId: req.user.id,
          name: nm,
          appearance: appearance || {},
          isActive: true,
        },
      });
    });

    res.json({ character: created });
  } catch (err) { next(err); }
});

/** POST /api/characters/:id/select — 해당 캐릭터를 활성화 */
router.post('/:id/select', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const target = await prisma.character.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!target) return res.status(404).json({ error: { message: '캐릭터를 찾을 수 없습니다.' } });

    const selected = await prisma.$transaction(async (tx) => {
      await tx.character.updateMany({
        where: { userId: req.user.id, isActive: true },
        data: { isActive: false },
      });
      return tx.character.update({
        where: { id },
        data: { isActive: true },
      });
    });

    res.json({ character: selected });
  } catch (err) { next(err); }
});

/** PATCH /api/characters/:id — 내 캐릭터 수정 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const existing = await prisma.character.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: { message: '캐릭터를 찾을 수 없습니다.' } });

    const { name, appearance } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = trimmedName(name);
    if (appearance !== undefined) data.appearance = appearance || {};
    if (data.name === '') return res.status(400).json({ error: { message: '이름을 입력해주세요.' } });

    const char = await prisma.character.update({
      where: { id },
      data,
    });
    res.json({ character: char });
  } catch (err) { next(err); }
});

/** DELETE /api/characters/:id — 내 캐릭터 삭제 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const existing = await prisma.character.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: { message: '캐릭터를 찾을 수 없습니다.' } });

    await prisma.$transaction(async (tx) => {
      await tx.character.delete({ where: { id } });

      if (existing.isActive) {
        const fallback = await tx.character.findFirst({
          where: { userId: req.user.id },
          orderBy: { updatedAt: 'desc' },
        });
        if (fallback) {
          await tx.character.update({
            where: { id: fallback.id },
            data: { isActive: true },
          });
        }
      }
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
