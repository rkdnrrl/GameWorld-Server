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

async function hydrateCharacter(character) {
  if (!character) return character;
  const appearance = character.appearance || {};
  const refCharacterId = appearance.refCharacterId || appearance.importedFrom?.characterId;
  if (!refCharacterId) return character;

  const source = await prisma.character.findFirst({
    where: { id: String(refCharacterId), isPublic: true },
    select: { appearance: true, name: true, user: { select: { username: true } } },
  });
  if (!source) return character;

  return {
    ...character,
    appearance: source.appearance || {},
    sourceCharacter: {
      id: String(refCharacterId),
      name: source.name,
      creatorName: source.user?.username || null,
    },
  };
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
    const hydrated = await Promise.all(characters.map(hydrateCharacter));
    const activeCharacter = hydrated.find((c) => c.isActive) || null;
    res.json({ characters: hydrated, activeCharacter });
  } catch (err) { next(err); }
});

// GET /api/characters/me : active character only
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const char = await prisma.character.findFirst({
      where: { userId: req.user.id, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ character: await hydrateCharacter(char || null) });
  } catch (err) { next(err); }
});

// GET /api/characters/public : public shared characters
/**
 * GET /api/characters/official — 공식 캐릭터 목록 (공개, 인증 불필요).
 * 모든 유저가 캐릭터 선택 화면에서 후보로 사용.
 * ⚠️ /:id 보다 앞에 정의해야 함 (Express 라우팅 순서).
 */
router.get('/official', async (_req, res, next) => {
  try {
    const characters = await prisma.character.findMany({
      where: { isOfficial: true },
      include: { user: { select: { username: true } } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
    res.json({ characters });
  } catch (err) { next(err); }
});

/**
 * PATCH /api/characters/:id/official — 공식 토글 (운영자 전용).
 * body: { isOfficial: bool }
 * 공식 등록 시 자동으로 isPublic 도 true 로 만듬 (공유 가능 상태로).
 */
const { requireOperator } = require('../middleware/operatorAuth');
router.patch('/:id/official', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const character = await prisma.character.findUnique({ where: { id: req.params.id } });
    if (!character) return res.status(404).json({ error: { message: '캐릭터 없음' } });
    const isOfficial = !!req.body?.isOfficial;
    const updated = await prisma.character.update({
      where: { id: req.params.id },
      data: { isOfficial, ...(isOfficial ? { isPublic: true } : {}) },
    });
    res.json({ character: updated });
  } catch (err) { next(err); }
});

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
    // 공개(isPublic) 또는 공식(isOfficial) 캐릭터 모두 import 가능
    const source = await prisma.character.findFirst({
      where: { id: sourceId, OR: [{ isPublic: true }, { isOfficial: true }] },
    });
    if (!source) return res.status(404).json({ error: { message: '공유 또는 공식 캐릭터를 찾을 수 없습니다.' } });

    const baseName = trimmedName(source.name) || 'Character';
    const myChars = await prisma.character.findMany({
      where: { userId: req.user.id },
      select: { id: true, name: true, appearance: true, isActive: true, isPublic: true, shareSlug: true, createdAt: true, updatedAt: true, userId: true },
    });
    const existingRef = myChars.find((c) => {
      const appearance = c.appearance || {};
      return appearance.refCharacterId === source.id || appearance.importedFrom?.characterId === source.id;
    });
    if (existingRef) {
      return res.json({ character: await hydrateCharacter(existingRef) });
    }

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
        appearance: {
          refOnly: true,
          refCharacterId: source.id,
          importedFrom: { characterId: source.id },
        },
        isActive: false,
      },
    });

    res.json({ character: await hydrateCharacter(character) });
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

    res.json({ character: await hydrateCharacter(selected) });
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
    res.json({ character: await hydrateCharacter(char) });
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
