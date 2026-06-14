const { Router } = require('express');
const path = require('node:path');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');
const r2 = require('../lib/r2');

const router = Router();
const CDN_BASE = 'https://play.airliveplay.com';

// 공식 캐릭터 FBX / GLB / GLTF / VRM 업로드 — 최대 60MB (VRM 은 보통 20~50MB)
const uploadFbx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
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

/**
 * library 엔트리 → 프론트가 쓰던 character shape 로 변환.
 * - id 는 character.id (delete/select 호출에 그대로 사용)
 * - appearance 에 custom 값 (modelScale/fbxOffsetY/fbxRotX) 덮어쓰기
 * - isActive 는 library 의 값
 */
function hydrateLibraryEntry(entry) {
  if (!entry || !entry.character) return null;
  const c = entry.character;
  const appearance = { ...(c.appearance || {}) };
  if (entry.customScale != null)   appearance.modelScale  = entry.customScale;
  if (entry.customYOffset != null) appearance.fbxOffsetY  = entry.customYOffset;
  if (entry.customRotX != null)    appearance.fbxRotX     = entry.customRotX;
  return {
    id:          c.id,
    userId:      entry.userId,
    name:        c.name,
    appearance,
    isActive:    entry.isActive,
    isPublic:    c.isPublic,
    isOfficial:  c.isOfficial,
    shareSlug:   c.shareSlug,
    createdAt:   entry.addedAt,
    updatedAt:   c.updatedAt,
    creatorId:   c.userId,
    creatorName: c.user?.username || null,
    libraryEntryId: entry.id,
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

// GET /api/characters : 내 라이브러리 (UserCharacterLibrary 기반) + 활성 캐릭터
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const entries = await prisma.userCharacterLibrary.findMany({
      where: { userId: req.user.id },
      include: { character: { include: { user: { select: { username: true } } } } },
      orderBy: [{ isActive: 'desc' }, { addedAt: 'desc' }],
    });
    const characters = entries.map(hydrateLibraryEntry).filter(Boolean);
    const activeCharacter = characters.find((c) => c.isActive) || null;
    res.json({ characters, activeCharacter });
  } catch (err) { next(err); }
});

// GET /api/characters/me : 활성 캐릭터만
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const entry = await prisma.userCharacterLibrary.findFirst({
      where: { userId: req.user.id, isActive: true },
      include: { character: { include: { user: { select: { username: true } } } } },
      orderBy: { addedAt: 'desc' },
    });
    res.json({ character: entry ? hydrateLibraryEntry(entry) : null });
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

        // 모델 업로드 시 R2 에 저장 (.fbx / .glb / .gltf / .vrm)
        const file = req.file;
        if (file) {
          const ext = path.extname(file.originalname).toLowerCase();
          if (ext !== '.fbx' && ext !== '.glb' && ext !== '.gltf' && ext !== '.vrm') {
            return res.status(400).json({ error: { message: 'FBX / GLB / GLTF / VRM 만 허용됩니다.' } });
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

        // 운영자 본인의 library 에도 등록 (자기 캐릭터 페이지에서 사용 가능)
        try {
          await prisma.userCharacterLibrary.create({
            data: { userId: req.user.id, characterId: character.id, isActive: false },
          });
        } catch (e) { /* unique 충돌 무시 */ }

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

// POST /api/characters : 새 캐릭터 생성 (Character + library 엔트리, 활성으로)
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

    const entry = await prisma.$transaction(async (tx) => {
      // 본인의 다른 라이브러리 항목 비활성
      await tx.userCharacterLibrary.updateMany({
        where: { userId: req.user.id, isActive: true },
        data: { isActive: false },
      });
      // Character row 생성 (creator = 본인)
      const char = await tx.character.create({
        data: { userId: req.user.id, name: nm, appearance: appearance || {}, isActive: false },
      });
      // library 엔트리 (custom 값은 NULL — 본인이 만든 거니까 원본 그대로)
      return tx.userCharacterLibrary.create({
        data: { userId: req.user.id, characterId: char.id, isActive: true },
        include: { character: { include: { user: { select: { username: true } } } } },
      });
    });

    res.json({ character: hydrateLibraryEntry(entry) });
  } catch (err) { next(err); }
});

// POST /api/characters/import/:id : 공개/공식 캐릭터를 내 라이브러리에 추가 (reference, 복사 안 함)
router.post('/import/:id', requireAuth, async (req, res, next) => {
  try {
    const sourceId = String(req.params.id || '');
    const source = await prisma.character.findFirst({
      where: { id: sourceId, OR: [{ isPublic: true }, { isOfficial: true }] },
      include: { user: { select: { username: true } } },
    });
    if (!source) return res.status(404).json({ error: { message: '공유 또는 공식 캐릭터를 찾을 수 없습니다.' } });

    await prisma.profile.upsert({
      where:  { id: req.user.id },
      create: { id: req.user.id, username: req.user.nickname || `user_${req.user.id.slice(0, 6)}` },
      update: {},
    });

    // upsert: 이미 라이브러리에 있으면 그 row 반환, 없으면 새로 생성
    const entry = await prisma.userCharacterLibrary.upsert({
      where: { userId_characterId: { userId: req.user.id, characterId: sourceId } },
      create: { userId: req.user.id, characterId: sourceId, isActive: false },
      update: {},
      include: { character: { include: { user: { select: { username: true } } } } },
    });

    res.json({ character: hydrateLibraryEntry(entry) });
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

    // 공식 캐릭터는 비공개 전환 금지 — import 한 유저들의 라이브러리가 이 원본을 참조하므로
    // 비공개되면 그 유저들의 캐릭터가 깨진다. 먼저 공식 해제(운영자 데스크탑) 후에만 비공개 가능.
    if (existing.isOfficial && nextPublic === false) {
      return res.status(403).json({ error: { message: '공식 캐릭터는 비공개로 전환할 수 없습니다. 먼저 공식 등록을 해제하세요.' } });
    }

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

// POST /api/characters/:id/select : library 의 (userId, characterId) row 를 활성으로 설정
router.post('/:id/select', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const target = await prisma.userCharacterLibrary.findUnique({
      where: { userId_characterId: { userId: req.user.id, characterId: id } },
    });
    if (!target) return res.status(404).json({ error: { message: '내 라이브러리에 없는 캐릭터입니다.' } });

    const selected = await prisma.$transaction(async (tx) => {
      await tx.userCharacterLibrary.updateMany({
        where: { userId: req.user.id, isActive: true },
        data: { isActive: false },
      });
      return tx.userCharacterLibrary.update({
        where: { id: target.id },
        data: { isActive: true },
        include: { character: { include: { user: { select: { username: true } } } } },
      });
    });

    res.json({ character: hydrateLibraryEntry(selected) });
  } catch (err) { next(err); }
});

// PATCH /api/characters/:id : 본인 라이브러리 + (creator 라면) Character 본체도 업데이트
//   - 본인이 creator: name + appearance 전체 수정 가능 + library custom 도 같이
//   - 본인이 아님: library 의 custom 필드만 (modelScale/fbxOffsetY/fbxRotX) 적용
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const libEntry = await prisma.userCharacterLibrary.findUnique({
      where: { userId_characterId: { userId: req.user.id, characterId: id } },
      include: { character: true },
    });
    if (!libEntry) return res.status(404).json({ error: { message: '내 라이브러리에 없는 캐릭터입니다.' } });

    const { name, appearance } = req.body || {};
    const isCreator = libEntry.character.userId === req.user.id;

    // library 의 custom 추출 — appearance 안의 modelScale/fbxOffsetY/fbxRotX 만
    const libData = {};
    if (appearance && typeof appearance === 'object') {
      if (appearance.modelScale !== undefined) libData.customScale   = appearance.modelScale;
      if (appearance.fbxOffsetY !== undefined) libData.customYOffset = appearance.fbxOffsetY;
      if (appearance.fbxRotX    !== undefined) libData.customRotX    = appearance.fbxRotX;
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(libData).length) {
        await tx.userCharacterLibrary.update({ where: { id: libEntry.id }, data: libData });
      }
      if (isCreator) {
        const charData = {};
        if (name !== undefined) {
          const nm = trimmedName(name);
          if (!nm) throw new Error('이름을 입력해주세요.');
          charData.name = nm;
        }
        if (appearance !== undefined) charData.appearance = appearance || {};
        if (Object.keys(charData).length) {
          await tx.character.update({ where: { id }, data: charData });
        }
      }
    });

    const refreshed = await prisma.userCharacterLibrary.findUnique({
      where: { id: libEntry.id },
      include: { character: { include: { user: { select: { username: true } } } } },
    });
    res.json({ character: hydrateLibraryEntry(refreshed) });
  } catch (err) { next(err); }
});

// DELETE /api/characters/:id : 내 라이브러리에서 분리 (orphan only).
// 정책: 어떤 경우에도 cascade 안 함 — 내 라이브러리 정리 동작. 다른 유저들 사용 그대로.
// 마켓플레이스에서 진짜 삭제하려면 admin/:id 사용 (운영자 전용).
//
// reference 모델 마이그레이션 완료 후: UserCharacterLibrary row 만 삭제 (Character 무관).
// 마이그레이션 전 호환: 옛 copy row 의 userId 만 null 처리 (옛 동작 그대로).
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');

    // [reference 모델 우선] UserCharacterLibrary 에 (userId, characterId) 매칭이 있으면 그 row 만 삭제.
    const lib = await prisma.userCharacterLibrary.findUnique({
      where: { userId_characterId: { userId: req.user.id, characterId: id } },
    }).catch(() => null); // 테이블 없으면 (마이그레이션 전) skip
    if (lib) {
      await prisma.$transaction(async (tx) => {
        await tx.userCharacterLibrary.delete({ where: { id: lib.id } });
        // 활성 캐릭터였으면 fallback 활성화
        if (lib.isActive) {
          const fallback = await tx.userCharacterLibrary.findFirst({
            where: { userId: req.user.id },
            orderBy: { addedAt: 'desc' },
          });
          if (fallback) await tx.userCharacterLibrary.update({ where: { id: fallback.id }, data: { isActive: true } });
        }
      });
      return res.json({ ok: true });
    }

    // [legacy copy 모델 호환] Character.userId 가 본인이면 orphan
    const existing = await prisma.character.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: { message: '캐릭터를 찾을 수 없습니다.' } });

    await prisma.$transaction(async (tx) => {
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
//  - import 한 클론(appearance.refCharacterId === id 또는 importedFrom.characterId === id) 도 함께 삭제
//  - appearance.modelUrl 과 매칭되는 마켓플레이스 Asset row (공식 캐릭터 생성 시 자동 등록된 것) 도 함께 삭제
//  - 그 Asset 의 import 클론(metadata.importedFrom.assetId 매칭) 도 함께 삭제
//  - R2 파일도 삭제 (캐릭터 row 가 진짜 owner)
router.delete('/admin/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    const existing = await prisma.character.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: { message: '캐릭터를 찾을 수 없습니다.' } });

    // 1) 캐릭터 클론 삭제 — refCharacterId / importedFrom 매칭 + 같은 modelUrl 매칭
    //    (운영자가 본인 라이브러리에 등록한 사본은 refCharacterId 가 안 박혀 있어서 modelUrl 로도 잡아야 함)
    const modelUrl = existing.appearance?.modelUrl;
    const cloneOr = [
      { appearance: { path: ['refCharacterId'],              equals: id } },
      { appearance: { path: ['importedFrom', 'characterId'], equals: id } },
    ];
    if (modelUrl) cloneOr.push({ appearance: { path: ['modelUrl'], equals: modelUrl } });
    const charClones = await prisma.character.findMany({
      where: { id: { not: id }, OR: cloneOr },
      select: { id: true },
    });
    if (charClones.length) {
      await prisma.character.deleteMany({ where: { id: { in: charClones.map(c => c.id) } } });
    }

    // 2) 마켓플레이스 Asset row(들) 찾기 — 같은 modelUrl
    let assetClonesDeleted = 0;
    let assetRowsDeleted = 0;
    if (modelUrl) {
      const assets = await prisma.asset.findMany({
        where: { modelUrl },
        select: { id: true },
      });
      if (assets.length) {
        const assetIds = assets.map(a => a.id);
        // 2a) 그 Asset 들의 import 클론(다른 Asset row) 도 삭제
        // Prisma JSON path 필터는 `in` 미지원 → assetId 별로 OR 조립
        const assetClones = await prisma.asset.findMany({
          where: {
            OR: assetIds.map(aid => ({
              metadata: { path: ['importedFrom', 'assetId'], equals: aid },
            })),
          },
          select: { id: true },
        });
        if (assetClones.length) {
          await prisma.asset.deleteMany({ where: { id: { in: assetClones.map(c => c.id) } } });
          assetClonesDeleted = assetClones.length;
        }
        // 2b) Asset row 들 삭제
        const del = await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
        assetRowsDeleted = del.count;
      }

      // 3) R2 파일 삭제 (modelUrl + thumbnailUrl 후보)
      const CDN_BASE = 'https://play.airliveplay.com';
      const r2KeyFromUrl = (url) => {
        if (!url || !url.startsWith(`${CDN_BASE}/`)) return null;
        return url.replace(`${CDN_BASE}/`, '');
      };
      try {
        const key = r2KeyFromUrl(modelUrl);
        if (key) await r2.deleteKeys([key]);
      } catch {}
    }

    await prisma.character.delete({ where: { id } });
    res.json({
      ok: true,
      clonedDeleted: charClones.length,
      assetsDeleted: assetRowsDeleted,
      assetClonesDeleted,
    });
  } catch (err) { next(err); }
});

module.exports = router;
