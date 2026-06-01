const { Router } = require('express');
const path = require('node:path');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');
const r2 = require('../lib/r2');

const router = Router();
const CDN_BASE = 'https://play.airliveplay.com';

// 공식 캐릭터 FBX 업로드 — 최대 30MB
const uploadFbx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

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
 * POST /api/characters/admin — 운영자가 공식 캐릭터 직접 생성 (multipart, FBX 업로드 포함).
 * fields: name, appearance (JSON 문자열)
 * file:   fbx (선택)
 * 생성 즉시 isOfficial=true, isPublic=true.
 */
router.post('/admin', requireAuth, async (req, res, next) => {
  // requireOperator 는 안에서 import
  const { requireOperator } = require('../middleware/operatorAuth');
  return requireOperator(req, res, () => {
    uploadFbx.single('fbx')(req, res, async (uerr) => {
      if (uerr) return res.status(400).json({ error: { message: uerr.message } });
      try {
        const name = trimmedName(req.body.name);
        if (!name) return res.status(400).json({ error: { message: '이름이 필요합니다.' } });
        let appearance = {};
        try {
          appearance = req.body.appearance ? JSON.parse(req.body.appearance) : {};
          if (!appearance || typeof appearance !== 'object') appearance = {};
        } catch { return res.status(400).json({ error: { message: 'appearance JSON 파싱 실패' } }); }

        // FBX 업로드 시 R2 에 저장
        const file = req.file;
        if (file) {
          const ext = path.extname(file.originalname).toLowerCase();
          if (ext !== '.fbx' && ext !== '.glb' && ext !== '.gltf') {
            return res.status(400).json({ error: { message: 'FBX / GLB / GLTF 만 허용됩니다.' } });
          }
          const charId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          // 'assets/' 접두사 — Cloudflare Worker 가 이 prefix 만 서빙. official-characters 폴더로 분리.
          const r2Key = `assets/official-characters/${charId}${ext}`;
          await r2.putObject(r2Key, file.buffer, {
            contentType: file.mimetype || r2.contentType(r2Key),
          });
          appearance.modelUrl = `${CDN_BASE}/${r2Key}`;
        }

        const character = await prisma.character.create({
          data: {
            userId:     req.user.id,
            name,
            appearance,
            isActive:   false,
            isPublic:   true,
            isOfficial: true,
          },
        });

        // FBX 가 있으면 같은 모델을 Asset 으로도 등록 → 에셋 마켓플레이스에 노출
        if (file && appearance.modelUrl) {
          try {
            await prisma.asset.create({
              data: {
                creatorId: req.user.id,
                name,
                modelUrl:  appearance.modelUrl,
                kind:      'model',
                fileSize:  BigInt(file.size),
                isPublic:  true,
                tags:      ['official-character'],
              },
            });
          } catch (e) {
            console.warn('[admin character] asset 생성 실패:', e.message);
          }
        }

        res.status(201).json({ character });
      } catch (err) { next(err); }
    });
  });
});

/**
 * GET /api/characters/official — 공식 캐릭터 목록 (공개, 인증 불필요).
 * 모든 유저가 캐릭터 선택 화면에서 후보로 사용.
 * ⚠️ /:id 보다 앞에 정의해야 함 (Express 라우팅 순서).
 */
router.get('/official', async (_req, res, next) => {
  try {
    const characters = await prisma.character.findMany({
      where: { isOfficial: true },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
    // 공식 캐릭터는 모두 "ALP" 명의로 — 운영자 username 숨김
    res.json({
      characters: characters.map(c => ({ ...c, user: { username: 'ALP' } })),
    });
  } catch (err) { next(err); }
});

/**
 * PATCH /api/characters/:id/official — 공식 토글 (운영자 전용).
 * body: { isOfficial: bool }
 * 공식 등록 시 자동으로 isPublic 도 true 로 만듬 (공유 가능 상태로).
 */
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
        // 공식 캐릭터는 ALP 명의로
        creatorName: c.isOfficial ? 'ALP' : (c.user?.username || null),
        isOfficial: !!c.isOfficial,
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

// DELETE /api/characters/:id : 내 라이브러리에서 분리 (orphan).
// 새 구조: 등록된 캐릭터 row 는 서버 자산. 유저는 row 를 진짜로 지우지 않고 자기 소유 링크만 끊는다.
// 누구나 가져오기(import) 로 다시 자기 라이브러리에 추가 가능. 진짜 row 삭제는 운영자 admin 엔드포인트.
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const existing = await prisma.character.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: { message: '캐릭터를 찾을 수 없습니다.' } });

    await prisma.$transaction(async (tx) => {
      // 공식이든 일반이든 동일: 내 소유 분리
      await tx.character.update({
        where: { id },
        data: { userId: null, isActive: false },
      });

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

// DELETE /api/characters/admin/:id : 진짜 row 삭제 (운영자 전용)
// userId 매칭 없이 어떤 캐릭터든 삭제 가능. 공식 캐릭터 관리/정리용.
// import 한 클론(appearance.refCharacterId === id 또는 importedFrom.characterId === id) 도 함께 삭제.
router.delete('/admin/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const existing = await prisma.character.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: { message: '캐릭터를 찾을 수 없습니다.' } });

    // 이 캐릭터를 import 한 모든 클론 찾기 — appearance JSON 의 두 경로 중 하나라도 매칭
    const clones = await prisma.character.findMany({
      where: {
        OR: [
          { appearance: { path: ['refCharacterId'], equals: id } },
          { appearance: { path: ['importedFrom', 'characterId'], equals: id } },
        ],
      },
      select: { id: true },
    });
    const clonedCount = clones.length;
    if (clonedCount) {
      await prisma.character.deleteMany({ where: { id: { in: clones.map(c => c.id) } } });
    }

    await prisma.character.delete({ where: { id } });
    res.json({ ok: true, clonedDeleted: clonedCount });
  } catch (err) { next(err); }
});

module.exports = router;
