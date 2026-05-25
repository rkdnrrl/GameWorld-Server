/**
 * 에셋 업로드 — 타입은 asset_kinds 테이블에서 동적으로 결정
 * 운영자가 새 타입(sound/video) 추가하면 코드 변경 없이 즉시 허용
 */
const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const r2 = require('../lib/r2');

const router = Router();

const CDN_BASE = 'https://play.airliveplay.com';

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
    const assetId   = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const r2Key     = `assets/${req.user.id}/${assetId}${ext}`;

    await r2.putObject(r2Key, file.buffer, {
      contentType: file.mimetype || r2.contentType(r2Key),
    });

    const modelUrl = `${CDN_BASE}/${r2Key}`;

    await ensureProfile(req.user);

    const asset = await prisma.asset.create({
      data: {
        creatorId: req.user.id,
        name:      assetName,
        modelUrl,
        kind:      kind.id,
        fileSize:  BigInt(file.size),
        isPublic:  false,
      },
    });

    // BigInt → string 직렬화
    res.json({ asset: serializeAsset(asset) });
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

/* GET /api/assets/public — 공개 에셋 목록 */
router.get('/public', async (req, res, next) => {
  try {
    const assets = await prisma.asset.findMany({
      where:   { isPublic: true },
      orderBy: { createdAt: 'desc' },
      take:    200,
      include: { creator: { select: { username: true } } },
    });
    res.json({ assets: assets.map(serializeAsset) });
  } catch (err) { next(err); }
});

/* PATCH /api/assets/:id — 이름/공개여부/태그/폴더/메타데이터 수정 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    const data = {};
    if (req.body.name           !== undefined) data.name     = String(req.body.name).slice(0, 100);
    if (req.body.isPublic       !== undefined) data.isPublic = Boolean(req.body.isPublic);
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
        if (a.modelUrl)     keys.push(a.modelUrl.replace(`${CDN_BASE}/`, ''));
        if (a.thumbnailUrl) keys.push(a.thumbnailUrl.replace(`${CDN_BASE}/`, ''));
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
      const r = await prisma.asset.updateMany({
        where: { id: { in: ownedIds } },
        data:  { isPublic },
      });
      result = { updated: r.count, isPublic };
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
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (asset.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });

    try {
      const key = asset.modelUrl.replace(`${CDN_BASE}/`, '');
      await r2.deleteKeys([key]);
      if (asset.thumbnailUrl) {
        const tKey = asset.thumbnailUrl.replace(`${CDN_BASE}/`, '');
        await r2.deleteKeys([tKey]);
      }
    } catch {}

    await prisma.asset.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* BigInt 직렬화 헬퍼 */
function serializeAsset(a) {
  if (!a) return a;
  return { ...a, fileSize: a.fileSize != null ? a.fileSize.toString() : null };
}

module.exports = router;
module.exports.invalidateKindsCache = invalidateKindsCache;
