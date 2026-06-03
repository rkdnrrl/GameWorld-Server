/**
 * 에셋 업로드 — 타입은 asset_kinds 테이블에서 동적으로 결정
 * 운영자가 새 타입(sound/video) 추가하면 코드 변경 없이 즉시 허용
 */
const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');
const r2 = require('../lib/r2');

const router = Router();

const CDN_BASE = 'https://play.airliveplay.com';

function ownedR2Key(url, userId) {
  if (!url || !url.startsWith(`${CDN_BASE}/`)) return null;
  const key = url.replace(`${CDN_BASE}/`, '');
  return key.startsWith(`assets/${userId}/`) ? key : null;
}

/** 운영자도 화이트리스트 못 하는 위험 확장자 (서버 강제) */
const DANGEROUS_EXTS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll', '.so', '.dylib',
  '.jar', '.app', '.deb', '.rpm', '.scr', '.vbs', '.com', '.pif',
  '.html', '.htm', '.svg',  // XSS 위험
]);

const HARD_MAX_BYTES = 500 * 1024 * 1024;   // 운영자가 maxSizeMb 잘못 설정해도 절대 500MB 못넘김
const MAX_THUMB_BYTES = 5 * 1024 * 1024;

const uploadModel = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: HARD_MAX_BYTES, files: 1 },
});

const uploadThumb = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_THUMB_BYTES, files: 1 },
});

/* ── asset_kinds 캐시 (60초) ── */
let kindsCache = { data: null, at: 0 };
async function getKindsCached() {
  const now = Date.now();
  if (kindsCache.data && now - kindsCache.at < 60_000) return kindsCache.data;
  const rows = await prisma.assetKind.findMany({ where: { enabled: true } });
  kindsCache = { data: rows, at: now };
  return rows;
}
function invalidateKindsCache() { kindsCache = { data: null, at: 0 }; }

/** 프로필 upsert 헬퍼 */
async function ensureProfile(user) {
  await prisma.profile.upsert({
    where:  { id: user.id },
    create: { id: user.id, username: user.nickname || `user_${user.id.slice(0, 6)}` },
    update: {},
  });
}

/* ─────────────────────────────────────────
   POST /api/assets/upload — 파일 업로드
   타입/확장자/크기/MIME 모두 asset_kinds DB 검증
───────────────────────────────────────── */
router.post('/upload', requireAuth, uploadModel.single('model'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: '파일을 첨부해주세요.' } });

    const ext = path.extname(file.originalname).toLowerCase();   // '.fbx'
    const extNoDot = ext.replace(/^\./, '');

    // 1) 위험 확장자 (서버 강제 블랙리스트)
    if (DANGEROUS_EXTS.has(ext)) {
      return res.status(400).json({ error: { message: '허용되지 않는 파일 형식입니다.' } });
    }

    // 2) DB 에서 매칭되는 활성 kind 찾기
    const kinds = await getKindsCached();
    const kind  = kinds.find(k => k.extensions.includes(extNoDot));
    if (!kind) {
      const allowed = kinds.flatMap(k => k.extensions).join(', ');
      return res.status(400).json({ error: { message: `지원하지 않는 형식입니다. 허용: ${allowed}` } });
    }

    // 3) 크기 검증
    if (file.size > kind.maxSizeMb * 1024 * 1024) {
      return res.status(413).json({ error: { message: `${kind.label} 최대 크기 ${kind.maxSizeMb}MB 초과` } });
    }

    // 4) MIME 검증 (선택 — kind 에 mimeTypes 설정돼 있을 때만)
    if (kind.mimeTypes && kind.mimeTypes.length > 0) {
      const mime = (file.mimetype || '').toLowerCase();
      const ok = kind.mimeTypes.some(prefix => mime.startsWith(prefix.toLowerCase()));
      if (!ok) {
        return res.status(400).json({ error: { message: '파일 형식과 내용이 일치하지 않습니다.' } });
      }
    }

    const assetName = (req.body.name || path.basename(file.originalname, ext)).slice(0, 100);

    await ensureProfile(req.user);

    // 폴더 — 현재 보고 있는 폴더로 자동 분류 (선택 사항)
    const folder = req.body.folder
      ? String(req.body.folder).slice(0, 200)
      : null;

    // 🗺 .alp / .alpmap.json — alp-map JSON 이면 파일 R2 저장 대신 metadata.data 에 보관
    // (클라이언트가 잘못된 경로로 보내도 서버에서 방어적으로 처리)
    if (kind.id === 'map' || /\.(alp|alpmap\.json)$/i.test(file.originalname)) {
      try {
        const text = file.buffer.toString('utf8');
        const parsed = JSON.parse(text);
        if (parsed && parsed.format === 'alp-map' && Array.isArray(parsed.objects)) {
          const finalName = (parsed.name || assetName).slice(0, 80);
          // env — 명시적 env or 최상위 환경 필드들 fallback
          const env = parsed.env || {
            bgColor: parsed.bgColor,
            ambientIntensity: parsed.ambientIntensity,
            preset: parsed.preset,
            fogDensity: parsed.fogDensity,
            hdriPreset: parsed.hdriPreset,
            camera: parsed.camera,
          };
          // terrain — 명시적 최상위 or kind:terrain 오브젝트에서 추출
          const terrainObj = parsed.objects.find(o => o && o.kind === 'terrain');
          const terrain = parsed.terrain || (terrainObj && terrainObj.terrain) || undefined;
          const data = { objects: parsed.objects, env, terrain };
          const serialized = JSON.stringify(data);
          if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) {
            return res.status(413).json({ error: { message: '맵 데이터 2MB 초과' } });
          }
          const asset = await prisma.asset.create({
            data: {
              creatorId: req.user.id,
              name:      finalName,
              modelUrl:  '',
              kind:      'map',
              fileSize:  BigInt(file.size),
              folder,
              isPublic:  false,
              metadata: {
                data,
                icon: typeof parsed.icon === 'string' ? parsed.icon.slice(0, 8) : '🗺',
                description: typeof parsed.description === 'string' ? parsed.description.slice(0, 300) : '',
                objectCount: parsed.objects.length,
                version: 1,
              },
            },
          });
          return res.json({ asset: serializeAsset(asset) });
        }
      } catch (e) {
        // JSON 파싱 실패 → 일반 파일 업로드로 fall through (예: 잘못된 .alp 파일은 R2 에 그대로 저장)
        console.warn('[upload] .alp parse failed, falling back to file storage:', e.message);
      }
    }

    const assetId   = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const r2Key     = `assets/${req.user.id}/${assetId}${ext}`;

    await r2.putObject(r2Key, file.buffer, {
      contentType: file.mimetype || r2.contentType(r2Key),
    });

    const modelUrl = `${CDN_BASE}/${r2Key}`;

    const asset = await prisma.asset.create({
      data: {
        creatorId: req.user.id,
        name:      assetName,
        modelUrl,
        kind:      kind.id,
        fileSize:  BigInt(file.size),
        folder,
        isPublic:  false,
      },
    });

    // BigInt → string 직렬화
    res.json({ asset: serializeAsset(asset) });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   POST /api/assets/script — 스크립트 asset 생성 (파일 X, 코드 텍스트 입력)
   body: { name, code, propsSchema?, icon?, folder? }
───────────────────────────────────────── */
router.post('/script', requireAuth, async (req, res, next) => {
  try {
    const { name, code, propsSchema, icon, description, folder } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: { message: '이름이 필요합니다.' } });
    }
    if (typeof code !== 'string') {
      return res.status(400).json({ error: { message: '코드가 필요합니다.' } });
    }
    if (code.length > 100 * 1024) {
      return res.status(413).json({ error: { message: '코드 크기 100KB 초과.' } });
    }
    const asset = await prisma.asset.create({
      data: {
        creatorId: req.user.id,
        name:      name.trim().slice(0, 80),
        modelUrl:  '',                              // 스크립트는 파일 없음
        kind:      'script',
        fileSize:  BigInt(Buffer.byteLength(code, 'utf8')),
        folder:    typeof folder === 'string' ? folder.slice(0, 200) : null,
        isPublic:  false,
        metadata:  {
          code,
          propsSchema: Array.isArray(propsSchema) ? propsSchema.slice(0, 40) : [],
          icon:        typeof icon === 'string' ? icon.slice(0, 8) : '📜',
          description: typeof description === 'string' ? description.slice(0, 300) : '',
        },
      },
    });
    res.json({ asset: serializeAsset(asset) });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   POST /api/assets/map  — 맵 스냅샷 asset 생성 (파일 X, JSON 데이터만)
   본문: { name, data: { objects, env, ... }, icon?, description?, folder? }
───────────────────────────────────────── */
router.post('/map', requireAuth, async (req, res, next) => {
  try {
    const { name, data, icon, description, folder } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: { message: '이름이 필요합니다.' } });
    }
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: { message: '맵 데이터가 필요합니다.' } });
    }
    const serialized = JSON.stringify(data);
    const byteSize = Buffer.byteLength(serialized, 'utf8');
    if (byteSize > 2 * 1024 * 1024) {
      return res.status(413).json({ error: { message: '맵 데이터 크기 2MB 초과.' } });
    }
    const asset = await prisma.asset.create({
      data: {
        creatorId: req.user.id,
        name:      name.trim().slice(0, 80),
        modelUrl:  '',                              // 맵은 파일 없음
        kind:      'map',
        fileSize:  BigInt(byteSize),
        folder:    typeof folder === 'string' ? folder.slice(0, 200) : null,
        isPublic:  false,
        metadata:  {
          data,                                      // { objects, env, terrain, ... }
          icon:        typeof icon === 'string' ? icon.slice(0, 8) : '🗺',
          description: typeof description === 'string' ? description.slice(0, 300) : '',
          objectCount: Array.isArray(data.objects) ? data.objects.length : 0,
          version:     1,
        },
      },
    });
    res.json({ asset: serializeAsset(asset) });
  } catch (err) { next(err); }
});

/* PATCH /api/assets/:id/map — 맵 데이터/메타 업데이트 (본인만) */
router.patch('/:id/map', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋을 찾을 수 없습니다.' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });
    if (asset.kind !== 'map') return res.status(400).json({ error: { message: 'map 에셋이 아닙니다.' } });

    const { name, data, icon, description } = req.body || {};
    const update = {};
    const meta = { ...(asset.metadata || {}) };
    if (typeof name === 'string' && name.trim()) update.name = name.trim().slice(0, 80);
    if (data && typeof data === 'object') {
      const serialized = JSON.stringify(data);
      const byteSize = Buffer.byteLength(serialized, 'utf8');
      if (byteSize > 2 * 1024 * 1024) return res.status(413).json({ error: { message: '맵 데이터 크기 2MB 초과.' } });
      meta.data = data;
      meta.objectCount = Array.isArray(data.objects) ? data.objects.length : 0;
      update.fileSize = BigInt(byteSize);
    }
    if (typeof icon === 'string') meta.icon = icon.slice(0, 8);
    if (typeof description === 'string') meta.description = description.slice(0, 300);
    update.metadata = meta;
    const updated = await prisma.asset.update({ where: { id }, data: update });
    res.json({ asset: serializeAsset(updated) });
  } catch (err) { next(err); }
});

/* PATCH /api/assets/:id/script — 코드/메타 업데이트 (본인만) */
router.patch('/:id/script', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋을 찾을 수 없습니다.' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });
    if (asset.kind !== 'script') return res.status(400).json({ error: { message: 'script 에셋이 아닙니다.' } });

    const { name, code, propsSchema, icon, description } = req.body || {};
    const update = {};
    const meta = { ...(asset.metadata || {}) };
    if (typeof name === 'string' && name.trim()) update.name = name.trim().slice(0, 80);
    if (typeof code === 'string') {
      if (code.length > 100 * 1024) return res.status(413).json({ error: { message: '코드 크기 100KB 초과.' } });
      meta.code = code;
      update.fileSize = BigInt(Buffer.byteLength(code, 'utf8'));
    }
    if (Array.isArray(propsSchema)) meta.propsSchema = propsSchema.slice(0, 40);
    if (typeof icon === 'string') meta.icon = icon.slice(0, 8);
    if (typeof description === 'string') meta.description = description.slice(0, 300);
    update.metadata = meta;
    const updated = await prisma.asset.update({ where: { id }, data: update });
    res.json({ asset: serializeAsset(updated) });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   POST /api/assets/:id/thumbnail — 썸네일 업로드
───────────────────────────────────────── */
router.post('/:id/thumbnail', requireAuth, uploadThumb.single('thumbnail'), async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: '이미지 첨부 필요' } });

    const ext    = path.extname(file.originalname).toLowerCase() || '.png';
    const r2Key  = `assets/${req.user.id}/thumb_${asset.id}${ext}`;
    await r2.putObject(r2Key, file.buffer, { contentType: file.mimetype });

    const thumbnailUrl = `${CDN_BASE}/${r2Key}`;
    const updated = await prisma.asset.update({
      where: { id: asset.id },
      data:  { thumbnailUrl },
    });

    res.json({ asset: serializeAsset(updated) });
  } catch (err) { next(err); }
});

/* GET /api/assets/my — 내 에셋 목록 */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const assets = await prisma.asset.findMany({
      where:   { creatorId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take:    500,
    });
    res.json({ assets: assets.map(serializeAsset) });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   GET /api/assets/public — 공개 에셋 검색 + 페이지네이션
   쿼리: q (이름·태그), kind, tag, sort (recent|name), page, pageSize
───────────────────────────────────────── */
const PAGE_SIZE_DEFAULT = 40;
const PAGE_SIZE_MAX     = 100;

router.get('/public', optionalAuth, async (req, res, next) => {
  try {
    const q        = String(req.query.q || '').trim();
    const kind     = String(req.query.kind || '').trim();
    const tag      = String(req.query.tag || '').trim();
    const sort     = String(req.query.sort || 'recent');
    const page     = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX,
      Math.max(1, parseInt(String(req.query.pageSize || PAGE_SIZE_DEFAULT)) || PAGE_SIZE_DEFAULT),
    );

    const where = { isPublic: true };
    if (kind) where.kind = kind;
    if (tag)  where.tags = { has: tag };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ];
    }

    const orderBy =
      sort === 'name'    ? [{ name: 'asc' }] :
      sort === 'popular' ? [{ likeCount: 'desc' }, { importCount: 'desc' }, { createdAt: 'desc' }] :
                           [{ createdAt: 'desc' }];

    const [total, assets] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where, orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { creator: { select: { username: true } } },
      }),
    ]);

    // 로그인 상태면 liked 여부 함께 반환
    let likedSet = new Set();
    if (req.user) {
      const likes = await prisma.assetLike.findMany({
        where: { userId: req.user.id, assetId: { in: assets.map(a => a.id) } },
        select: { assetId: true },
      });
      likedSet = new Set(likes.map(l => l.assetId));
    }

    res.json({
      assets: assets.map(a => ({ ...serializeAsset(a), liked: likedSet.has(a.id) })),
      page, pageSize, total,
      hasMore: page * pageSize < total,
    });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   POST   /api/assets/:id/like   — 좋아요 (멱등)
   DELETE /api/assets/:id/like   — 좋아요 취소 (멱등)
───────────────────────────────────────── */
router.post('/:id/like', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const asset = await prisma.asset.findUnique({
      where: { id },
      select: { id: true, isPublic: true, creatorId: true, name: true },
    });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (!asset.isPublic) return res.status(403).json({ error: { message: '공개 에셋만 좋아요 가능' } });
    if (asset.creatorId === req.user.id) return res.status(400).json({ error: { message: '본인 에셋엔 좋아요 불가' } });

    let isNew = false;
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.assetLike.findUnique({
        where: { userId_assetId: { userId: req.user.id, assetId: id } },
      });
      if (existing) {
        const a = await tx.asset.findUnique({ where: { id }, select: { likeCount: true } });
        return { liked: true, likeCount: a.likeCount };
      }
      isNew = true;
      await tx.assetLike.create({ data: { userId: req.user.id, assetId: id } });
      const a = await tx.asset.update({
        where: { id },
        data:  { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
      return { liked: true, likeCount: a.likeCount };
    });

    // 새 좋아요 시 작가에게 알림 (best-effort)
    if (isNew && asset.creatorId) {
      require('./notifications').createNotification(asset.creatorId, 'asset_liked', {
        assetId: asset.id, assetName: asset.name, actorName: req.user.nickname,
      });
    }
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:id/like', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.assetLike.findUnique({
        where: { userId_assetId: { userId: req.user.id, assetId: id } },
      });
      if (!existing) {
        const a = await tx.asset.findUnique({ where: { id }, select: { likeCount: true } });
        return { liked: false, likeCount: a?.likeCount ?? 0 };
      }
      await tx.assetLike.delete({ where: { userId_assetId: { userId: req.user.id, assetId: id } } });
      const a = await tx.asset.update({
        where: { id },
        data:  { likeCount: { decrement: 1 } },
        select: { likeCount: true },
      });
      return { liked: false, likeCount: Math.max(0, a.likeCount) };
    });
    res.json(result);
  } catch (err) { next(err); }
});

/* POST /api/assets/:id/report — 신고 (asset-reports.js 의 submitReport 위임) */
router.post('/:id/report', requireAuth, require('./asset-reports').submitReport);

/* ─────────────────────────────────────────
   에셋 버전 관리
     GET    /:id/versions               — 버전 목록 (소유자만)
     POST   /:id/versions  (multipart)  — 새 버전 업로드 + 현재로 설정
     POST   /:id/versions/:v/revert     — 특정 버전을 현재로 복원
     DELETE /:id/versions/:v            — 버전 삭제 (현재 버전은 불가)
───────────────────────────────────────── */
router.get('/:id/versions', requireAuth, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    const versions = await prisma.assetVersion.findMany({
      where: { assetId: asset.id },
      orderBy: { version: 'desc' },
    });
    res.json({
      currentVersion: asset.currentVersion,
      versions: versions.map(v => ({ ...v, fileSize: v.fileSize != null ? v.fileSize.toString() : null })),
    });
  } catch (err) { next(err); }
});

router.post('/:id/versions', requireAuth, uploadModel.single('model'), async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    const file = req.file;
    if (!file) return res.status(400).json({ error: { message: '파일 필요' } });

    const ext = path.extname(file.originalname).toLowerCase();
    const extNoDot = ext.replace(/^\./, '');

    if (DANGEROUS_EXTS.has(ext)) {
      return res.status(400).json({ error: { message: '허용되지 않는 파일 형식' } });
    }
    const kinds = await getKindsCached();
    const kind  = kinds.find(k => k.extensions.includes(extNoDot));
    if (!kind) return res.status(400).json({ error: { message: '지원하지 않는 형식' } });
    // 동일 kind 유지 — 다른 kind 로 바꾸려면 새 에셋 만드는 게 안전
    if (asset.kind && asset.kind !== kind.id) {
      return res.status(400).json({
        error: { message: `현재 타입(${asset.kind})과 다른 형식 업로드 불가. 새 에셋으로 올려주세요.` },
      });
    }
    if (file.size > kind.maxSizeMb * 1024 * 1024) {
      return res.status(413).json({ error: { message: `${kind.label} 최대 ${kind.maxSizeMb}MB 초과` } });
    }

    const nextVersion = asset.currentVersion + 1;
    const r2Key = `assets/${req.user.id}/${asset.id}_v${nextVersion}${ext}`;

    await r2.putObject(r2Key, file.buffer, { contentType: file.mimetype || r2.contentType(r2Key) });
    const modelUrl = `${CDN_BASE}/${r2Key}`;

    const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;

    await prisma.$transaction([
      prisma.assetVersion.create({
        data: {
          assetId:      asset.id,
          version:      nextVersion,
          modelUrl,
          thumbnailUrl: null,
          fileSize:     BigInt(file.size),
          note,
        },
      }),
      prisma.asset.update({
        where: { id: asset.id },
        data:  { modelUrl, fileSize: BigInt(file.size), currentVersion: nextVersion },
      }),
    ]);

    const updated = await prisma.asset.findUnique({ where: { id: asset.id } });
    res.json({ asset: serializeAsset(updated), version: nextVersion });
  } catch (err) { next(err); }
});

router.post('/:id/versions/:v/revert', requireAuth, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    const v = parseInt(String(req.params.v), 10);
    if (!Number.isFinite(v)) return res.status(400).json({ error: { message: 'version 잘못됨' } });
    if (v === asset.currentVersion) return res.status(400).json({ error: { message: '이미 현재 버전' } });

    const target = await prisma.assetVersion.findUnique({
      where: { assetId_version: { assetId: asset.id, version: v } },
    });
    if (!target) return res.status(404).json({ error: { message: '버전 없음' } });

    const updated = await prisma.asset.update({
      where: { id: asset.id },
      data:  {
        modelUrl:       target.modelUrl,
        fileSize:       target.fileSize,
        currentVersion: v,
        // 썸네일은 의도적으로 유지 (썸네일은 별도 업로드 자산)
      },
    });
    res.json({ asset: serializeAsset(updated) });
  } catch (err) { next(err); }
});

router.delete('/:id/versions/:v', requireAuth, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    const v = parseInt(String(req.params.v), 10);
    if (!Number.isFinite(v)) return res.status(400).json({ error: { message: 'version 잘못됨' } });
    if (v === asset.currentVersion) {
      return res.status(400).json({ error: { message: '현재 버전은 삭제 불가 (다른 버전으로 복원 후 시도)' } });
    }

    const target = await prisma.assetVersion.findUnique({
      where: { assetId_version: { assetId: asset.id, version: v } },
    });
    if (!target) return res.status(404).json({ error: { message: '버전 없음' } });

    // R2 best-effort
    try {
      const key = target.modelUrl.replace(`${CDN_BASE}/`, '');
      if (key) await r2.deleteKeys([key]);
    } catch {}

    await prisma.assetVersion.delete({
      where: { assetId_version: { assetId: asset.id, version: v } },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* GET /api/assets/my-likes — 내가 좋아요한 에셋 id 목록 */
router.get('/my-likes', requireAuth, async (req, res, next) => {
  try {
    const likes = await prisma.assetLike.findMany({
      where:  { userId: req.user.id },
      select: { assetId: true },
    });
    res.json({ ids: likes.map(l => l.assetId) });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   POST /api/assets/:id/clone — 공개 에셋을 내 라이브러리로 복사
   원본 R2 파일을 내 prefix 로 복사, DB row 생성, 메타데이터에 출처 기록
───────────────────────────────────────── */
router.post('/:id/clone', requireAuth, async (req, res, next) => {
  try {
    const src = await prisma.asset.findUnique({
      where: { id: req.params.id },
      include: { creator: { select: { username: true } } },
    });
    if (!src) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (!src.isPublic) return res.status(403).json({ error: { message: '공개 에셋만 복사 가능' } });
    if (src.creatorId === req.user.id) {
      return res.status(400).json({ error: { message: '본인 에셋은 복사할 수 없습니다.' } });
    }

    await ensureProfile(req.user);

    // R2 key 추출 + 새 key 생성
    const existingRefs = await prisma.asset.findMany({
      where: { creatorId: req.user.id, modelUrl: src.modelUrl },
      take: 20,
    });
    const existingRef = existingRefs.find((a) => a.metadata?.importedFrom?.assetId === src.id);
    if (existingRef) {
      return res.json({ asset: serializeAsset(existingRef) });
    }

    const srcKey = src.modelUrl.replace(`${CDN_BASE}/`, '');
    const ext = path.extname(srcKey);
    const newId  = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const dstKey = `assets/${req.user.id}/${newId}${ext}`;

    try {
      // Imported assets reference the source file instead of copying it.
    } catch (e) {
      return res.status(500).json({ error: { message: '원본 파일 복사 실패' } });
    }

    let thumbDstUrl = src.thumbnailUrl;
    if (src.thumbnailUrl) {
      try {
        const tSrcKey = src.thumbnailUrl.replace(`${CDN_BASE}/`, '');
        const tExt    = path.extname(tSrcKey) || '.png';
        const tDstKey = `assets/${req.user.id}/thumb_${newId}${tExt}`;
        thumbDstUrl = src.thumbnailUrl;
      } catch {}
    }

    const modelUrl = src.modelUrl;
    const meta = {
      ...(src.metadata || {}),
      importedFrom: { assetId: src.id, creatorName: src.creator?.username || null },
      referenceOnly: true,
    };

    const cloned = await prisma.asset.create({
      data: {
        creatorId:    req.user.id,
        name:         src.name,
        modelUrl,
        thumbnailUrl: thumbDstUrl,
        kind:         src.kind,
        metadata:     meta,
        tags:         src.tags || [],
        fileSize:     src.fileSize,
        isPublic:     false,
      },
    });

    // 원본의 importCount 증가 (best-effort, 실패해도 응답 보냄)
    prisma.asset.update({
      where: { id: src.id },
      data:  { importCount: { increment: 1 } },
    }).catch(() => {});

    // 작가에게 알림
    if (src.creatorId) {
      require('./notifications').createNotification(src.creatorId, 'asset_imported', {
        assetId: src.id, assetName: src.name, actorName: req.user.nickname,
      });
    }

    res.json({ asset: serializeAsset(cloned) });
  } catch (err) { next(err); }
});

/* PATCH /api/assets/:id — 이름/공개여부/태그/폴더/메타데이터 수정 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    // 참조/임포트된 에셋(다른 사람 원본을 가리킴)은 본인 소유여도 공개 토글 금지 —
    // 원작자 모르게 마켓에 같은 파일이 도배되는 걸 막음. 옛 데이터 호환 위해 importedFrom 도 체크.
    const isImportedReference = !!(asset.metadata?.referenceOnly || asset.metadata?.importedFrom);

    const data = {};
    if (req.body.name           !== undefined) data.name     = String(req.body.name).slice(0, 100);
    if (req.body.isPublic       !== undefined) {
      if (isImportedReference) {
        return res.status(403).json({ error: { message: '참조/임포트된 에셋은 공개여부 변경 불가 — 원본 작가의 에셋입니다.' } });
      }
      data.isPublic = Boolean(req.body.isPublic);
    }
    if (req.body.tags           !== undefined && Array.isArray(req.body.tags)) {
      data.tags = req.body.tags.map(t => String(t).slice(0, 50)).slice(0, 30);
    }
    if (req.body.folder         !== undefined) data.folder   = req.body.folder ? String(req.body.folder).slice(0, 200) : null;
    if (req.body.metadata       !== undefined) data.metadata = req.body.metadata;
    // 하위 호환: materialConfig 가 오면 metadata.materialConfig 로 저장
    if (req.body.materialConfig !== undefined) {
      data.metadata = { ...(asset.metadata || {}), materialConfig: req.body.materialConfig };
    }

    const updated = await prisma.asset.update({ where: { id: req.params.id }, data });
    res.json({ asset: serializeAsset(updated) });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   POST /api/assets/batch — 일괄 작업
   body: { ids: string[], action: 'delete'|'move'|'addTags'|'removeTags'|'setPublic', value?: any }
───────────────────────────────────────── */
const BATCH_MAX = 200;
router.post('/batch', requireAuth, async (req, res, next) => {
  try {
    const { ids, action } = req.body || {};
    const value = req.body?.value;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { message: 'ids 필요' } });
    }
    if (ids.length > BATCH_MAX) {
      return res.status(400).json({ error: { message: `한 번에 ${BATCH_MAX}개 까지` } });
    }
    const allowedActions = new Set(['delete', 'move', 'addTags', 'removeTags', 'setPublic']);
    if (!allowedActions.has(action)) {
      return res.status(400).json({ error: { message: 'action 잘못됨' } });
    }

    // 소유 검증 — 본인 것만 필터
    const owned = await prisma.asset.findMany({
      where: { id: { in: ids }, creatorId: req.user.id },
      select: { id: true, modelUrl: true, thumbnailUrl: true, tags: true },
    });
    const ownedIds = owned.map(a => a.id);
    if (ownedIds.length === 0) {
      return res.status(403).json({ error: { message: '권한 있는 에셋 없음' } });
    }

    let result;
    if (action === 'delete') {
      // R2 키 모아서 best-effort 삭제
      const keys = [];
      for (const a of owned) {
        const modelKey = ownedR2Key(a.modelUrl, req.user.id);
        const thumbKey = ownedR2Key(a.thumbnailUrl, req.user.id);
        if (modelKey) keys.push(modelKey);
        if (thumbKey) keys.push(thumbKey);
      }
      try { if (keys.length) await r2.deleteKeys(keys); } catch {}
      const r = await prisma.asset.deleteMany({ where: { id: { in: ownedIds } } });
      result = { deleted: r.count };
    } else if (action === 'move') {
      // value = folder (string|null)
      const folder = value ? String(value).slice(0, 200) : null;
      const r = await prisma.asset.updateMany({
        where: { id: { in: ownedIds } },
        data:  { folder },
      });
      result = { updated: r.count, folder };
    } else if (action === 'setPublic') {
      const isPublic = Boolean(value);
      // 참조/임포트된 에셋 제외 — 원작자 권리 보호
      const safeIds = [];
      const skipped = [];
      const rows = await prisma.asset.findMany({
        where: { id: { in: ownedIds } },
        select: { id: true, metadata: true },
      });
      for (const r of rows) {
        if (r.metadata?.referenceOnly || r.metadata?.importedFrom) skipped.push(r.id);
        else safeIds.push(r.id);
      }
      const r = safeIds.length > 0
        ? await prisma.asset.updateMany({
            where: { id: { in: safeIds } },
            data:  { isPublic },
          })
        : { count: 0 };
      result = { updated: r.count, isPublic, skipped };
    } else if (action === 'addTags' || action === 'removeTags') {
      // PG 배열 연산은 updateMany 로 안되니 row 단위 처리 (트랜잭션)
      if (!Array.isArray(value) || value.length === 0) {
        return res.status(400).json({ error: { message: 'value: 태그 배열 필요' } });
      }
      const incoming = value.map(t => String(t).trim().slice(0, 50)).filter(Boolean);
      const ops = owned.map(a => {
        const current = a.tags || [];
        let next;
        if (action === 'addTags') {
          next = Array.from(new Set([...current, ...incoming])).slice(0, 30);
        } else {
          const remove = new Set(incoming);
          next = current.filter(t => !remove.has(t));
        }
        return prisma.asset.update({ where: { id: a.id }, data: { tags: next } });
      });
      await prisma.$transaction(ops);
      result = { updated: owned.length };
    }

    res.json({ ok: true, ...result, skipped: ids.length - ownedIds.length });
  } catch (err) { next(err); }
});

/* DELETE /api/assets/:id */
// 새 구조: 에셋 등록 시 즉시 서버 자산. 유저는 자기 라이브러리에서만 분리(orphan).
// 진짜 row + R2 파일 삭제는 운영자 admin 엔드포인트에서만.
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    // creatorId 만 NULL 처리 → 내 라이브러리에서 사라지지만 row + R2 파일은 보존, 마켓에서 계속 사용 가능
    await prisma.asset.update({
      where: { id: req.params.id },
      data: { creatorId: null },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// 운영자 전용: 진짜 row + R2 파일 삭제. creatorId 매칭 무시.
// clone 은 referenceOnly (같은 R2 파일을 가리킴) 이므로 R2 파일 삭제 시 자동으로 못쓰게 되지만,
// DB 정리를 위해 metadata.importedFrom.assetId 가 이 id 인 모든 clone row 도 함께 삭제.
router.delete('/admin/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });

    // R2 파일 키는 URL 에서 직접 추출 (creatorId 가 null 이어도 동작)
    const r2KeyFromUrl = (url) => {
      if (!url || !url.startsWith(`${CDN_BASE}/`)) return null;
      return url.replace(`${CDN_BASE}/`, '');
    };
    try {
      const keys = [r2KeyFromUrl(asset.modelUrl), r2KeyFromUrl(asset.thumbnailUrl)].filter(Boolean);
      if (keys.length) await r2.deleteKeys(keys);
    } catch {}

    // metadata->importedFrom->assetId = req.params.id 인 clone row 모두 삭제
    // Prisma JSON path 필터 사용
    const clones = await prisma.asset.findMany({
      where: {
        metadata: { path: ['importedFrom', 'assetId'], equals: req.params.id },
      },
      select: { id: true },
    });
    const clonedCount = clones.length;
    if (clonedCount) {
      await prisma.asset.deleteMany({ where: { id: { in: clones.map(c => c.id) } } });
    }

    await prisma.asset.delete({ where: { id: req.params.id } });
    res.json({ ok: true, clonedDeleted: clonedCount });
  } catch (err) { next(err); }
});

/* BigInt 직렬화 헬퍼 */
function serializeAsset(a) {
  if (!a) return a;
  return { ...a, fileSize: a.fileSize != null ? a.fileSize.toString() : null };
}

module.exports = router;
module.exports.invalidateKindsCache = invalidateKindsCache;
