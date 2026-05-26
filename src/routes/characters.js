const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

function trimmedName(raw) {
  return String(raw || '').trim().slice(0, 30);
}

function makeShareSlug() {
  return `char_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

let sharingSchemaReady = null;
function ensureSharingSchema() {
  if (!sharingSchemaReady) {
    sharingSchemaReady = (async () => {
      await prisma.$executeRawUnsafe('ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "is_public" BOOLEAN NOT NULL DEFAULT false');
      await prisma.$executeRawUnsafe('ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "share_slug" TEXT');
      await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "characters_share_slug_key" ON "characters" ("share_slug") WHERE "share_slug" IS NOT NULL');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "characters_is_public_updatedAt_idx" ON "characters" ("is_public", "updatedAt")');
    })().catch((err) => {
      sharingSchemaReady = null;
      throw err;
    });
  }
  return sharingSchemaReady;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureSharingSchema();
    next();
  } catch (err) {
    next(err);
  }
});

// GET /api/characters : my characters + active character
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

// GET /api/characters/me : active character only
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const char = await prisma.character.findFirst({
      where: { userId: req.user.id, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ character: char || null });
  } catch (err) { next(err); }
});

// GET /api/characters/public : public shared characters
router.get('/public', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const where = {
      isPublic: true,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { user: { username: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const characters = await prisma.character.findMany({
      where,
      include: {
        user: { select: { username: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 60,
    });

    res.json({
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        appearance: c.appearance || {},
        updatedAt: c.updatedAt,
        shareSlug: c.shareSlug || null,
        creatorName: c.user?.username || null,
      })),
    });
  } catch (err) { next(err); }
});

// POST /api/characters : create and set active
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

// POST /api/characters/import/:id : clone a public character into my account
router.post('/import/:id', requireAuth, async (req, res, next) => {
  try {
    const sourceId = String(req.params.id || '');
    const source = await prisma.character.findFirst({
      where: { id: sourceId, isPublic: true },
    });
    if (!source) return res.status(404).json({ error: { message: '공유 캐릭터를 찾을 수 없습니다.' } });

    const baseName = trimmedName(source.name) || 'Character';
    const myChars = await prisma.character.findMany({
      where: { userId: req.user.id },
      select: { name: true },
    });
    const usedNames = new Set(myChars.map((c) => c.name));
    let nextName = baseName;
    let i = 2;
    while (usedNames.has(nextName)) {
      nextName = `${baseName} (${i})`.slice(0, 30);
      i += 1;
    }

    const character = await prisma.character.create({
      data: {
        userId: req.user.id,
        name: nextName,
        appearance: source.appearance || {},
        isActive: false,
      },
    });

    res.json({ character });
  } catch (err) { next(err); }
});

// POST /api/characters/:id/share : toggle or set public/private
router.post('/:id/share', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const existing = await prisma.character.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: { message: '캐릭터를 찾을 수 없습니다.' } });

    const requested = req.body?.isPublic;
    const nextPublic = typeof requested === 'boolean' ? requested : !existing.isPublic;

    let shareSlug = existing.shareSlug;
    if (nextPublic && !shareSlug) {
      shareSlug = makeShareSlug();
    }

    const character = await prisma.character.update({
      where: { id },
      data: {
        isPublic: nextPublic,
        shareSlug,
      },
    });

    res.json({ character });
  } catch (err) { next(err); }
});

// POST /api/characters/:id/select : set selected character active
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

// PATCH /api/characters/:id : update character
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

// DELETE /api/characters/:id : delete character
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
