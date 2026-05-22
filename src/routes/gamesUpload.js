/**
 * UGC 게임 업로드 + 모더레이션 라우트.
 *
 * 공개:
 *   POST   /api/games/upload                  — 개발자가 zip 업로드 (status: pending)
 *   GET    /api/games/mine                    — 내 게임 목록
 *   PATCH  /api/games/:slug                   — 메타 수정 (본인만)
 *   DELETE /api/games/:slug                   — 삭제 (본인 또는 운영자)
 *
 * 운영자 전용:
 *   GET  /api/operator/games/pending          — 대기 큐
 *   POST /api/operator/games/:slug/approve    — 승인
 *   POST /api/operator/games/:slug/reject     — 거절
 *   POST /api/operator/games/:slug/hide       — 숨김 (이미 published 였을 때)
 */

const { Router } = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { z } = require('zod');

const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const r2 = require('../lib/r2');
const { logActivity } = require('../lib/activityLog');

const router = Router();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_FILES = 500;
const ALLOWED_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['admin', 'api', 'operator', 'develop', 'games', 'auth', 'login', 'signup', 'play']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

// 운영자 전용 — 파일 크기 제한 없음 (size 검사는 라우트 핸들러에서 수행 안 함)
const uploadUnlimited = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1 },
});

const uploadSchema = z.object({
  slug: z.string().min(2).max(60).regex(ALLOWED_SLUG_RE, 'slug 형식 잘못됨 (소문자/숫자/하이픈)'),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  emoji: z.string().max(16).optional().default('🎮'),
  category: z.enum(['earn', 'multiplay', 'decorate', 'other']).optional().default('other'),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
});

function parseTags(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.slice(0, 10).map((t) => String(t).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed.slice(0, 10).map((t) => String(t).trim()).filter(Boolean);
  } catch { /* fall through */ }
  return String(v).split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
}

/**
 * POST /api/games/upload  (multipart/form-data)
 *   fields: slug, title, description, emoji, category, tags
 *   file:   gamezip   (game.zip — index.html 포함된 게임 파일들)
 */
router.post('/upload', requireAuth, upload.single('gamezip'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: 'gamezip 파일 필요' } });

    const parsed = uploadSchema.parse(req.body);
    const slug = parsed.slug.toLowerCase();
    if (RESERVED_SLUGS.has(slug)) {
      return res.status(400).json({ error: { message: '예약된 slug 입니다.' } });
    }
    const tags = parseTags(parsed.tags);

    // 중복 slug 검사
    const existing = await prisma.game.findUnique({ where: { slug } });
    if (existing) {
      return res.status(409).json({ error: { message: '이미 사용 중인 slug 입니다.' } });
    }

    // zip 풀기
    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      return res.status(400).json({ error: { message: 'zip 파일이 손상되었습니다.' } });
    }
    // entry 별 경로 정규화 — Windows 에서 만든 zip 이 백슬래시(\) 를 entryName 으로 박는 경우가 있어
    // R2 키 / HTTP URL 과 매칭되도록 forward slash 로 변환한다.
    const entries = zip.getEntries()
      .filter((e) => !e.isDirectory)
      .map((e) => ({ raw: e, name: e.entryName.replace(/\\/g, '/') }));
    if (entries.length === 0) {
      return res.status(400).json({ error: { message: 'zip 안에 파일이 없습니다.' } });
    }
    if (entries.length > MAX_FILES) {
      return res.status(400).json({ error: { message: `파일이 너무 많습니다 (최대 ${MAX_FILES}개).` } });
    }

    // index.html 존재 확인 (zip 루트 또는 단일 폴더 안)
    let rootPrefix = '';
    const hasRoot = entries.some((e) => e.name === 'index.html');
    if (!hasRoot) {
      // 단일 폴더 안에 있는 경우 그 폴더를 root 로 취급
      const firstParts = new Set(entries.map((e) => e.name.split('/')[0]));
      if (firstParts.size === 1) {
        const candidate = [...firstParts][0];
        if (entries.some((e) => e.name === `${candidate}/index.html`)) {
          rootPrefix = `${candidate}/`;
        }
      }
    }
    if (!entries.some((e) => e.name === `${rootPrefix}index.html`)) {
      return res.status(400).json({ error: { message: 'zip 안에 index.html 이 없습니다.' } });
    }

    // R2 에 업로드
    const storagePath = `games/${slug}/`;
    let uploadedBytes = 0;
    for (const entry of entries) {
      let rel = entry.name;
      if (rootPrefix && rel.startsWith(rootPrefix)) rel = rel.slice(rootPrefix.length);
      // 보안: 경로 정규화
      if (rel.includes('..') || rel.startsWith('/')) continue;
      const data = entry.raw.getData();
      uploadedBytes += data.length;
      await r2.putObject(`${storagePath}${rel}`, data);
    }

    // DB INSERT
    const game = await prisma.game.create({
      data: {
        slug,
        ownerUserId: req.user.id,
        title: parsed.title,
        description: parsed.description,
        emoji: parsed.emoji || '🎮',
        kind: 'community',
        status: 'pending', // 운영자 승인 대기
        category: parsed.category,
        storagePath,
        tags: tags.length > 0 ? tags : undefined,
        version: 1,
      },
    });

    logActivity(req.user, 'game_upload', { slug: game.slug, title: game.title, kind: game.kind });

    res.status(201).json({
      ok: true,
      game: { slug: game.slug, status: game.status, storagePath, uploadedBytes },
      message: '업로드 완료. 운영자 검토 후 공개됩니다.',
    });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 검증 실패' } });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: { message: `파일이 너무 큽니다 (최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).` } });
    }
    console.error('upload error:', err);
    next(err);
  }
});

/**
 * POST /api/games/:slug/files — 기존 게임 재업로드 (검수 대기 큐로 진입).
 * 권한: owner 본인 OR operator. official 게임은 operator 만.
 * 동작: 라이브(production storagePath)는 그대로 두고 R2 staging prefix 에 새 zip 업로드.
 *      DB 에 pendingStoragePath/pendingVersion 기록. 운영자가 별도 라우트로 승인·거절.
 */
router.post('/:slug/files', requireAuth, uploadUnlimited.single('gamezip'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: 'gamezip 파일 필요' } });
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });

    const isOwner = g.ownerUserId && g.ownerUserId === req.user.id;
    const isOperator = !!req.user.isOperator;
    if (!isOwner && !isOperator) {
      return res.status(403).json({ error: { message: '권한이 없습니다.' } });
    }
    if (g.kind === 'official' && !isOperator) {
      return res.status(403).json({ error: { message: '공식 게임은 운영자만 업데이트할 수 있습니다.' } });
    }
    // 일반 유저는 50MB 제한, 운영자는 무제한
    if (!isOperator && req.file.size > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: { message: `파일이 너무 큽니다 (최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).` } });
    }

    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      return res.status(400).json({ error: { message: 'zip 파일이 손상되었습니다.' } });
    }
    const entries = zip.getEntries()
      .filter((e) => !e.isDirectory)
      .map((e) => ({ raw: e, name: e.entryName.replace(/\\/g, '/') }));
    if (entries.length === 0) {
      return res.status(400).json({ error: { message: 'zip 안에 파일이 없습니다.' } });
    }
    if (entries.length > MAX_FILES) {
      return res.status(400).json({ error: { message: `파일이 너무 많습니다 (최대 ${MAX_FILES}개).` } });
    }

    let rootPrefix = '';
    if (!entries.some((e) => e.name === 'index.html')) {
      const firstParts = new Set(entries.map((e) => e.name.split('/')[0]));
      if (firstParts.size === 1) {
        const candidate = [...firstParts][0];
        if (entries.some((e) => e.name === `${candidate}/index.html`)) {
          rootPrefix = `${candidate}/`;
        }
      }
    }
    if (!entries.some((e) => e.name === `${rootPrefix}index.html`)) {
      return res.status(400).json({ error: { message: 'zip 안에 index.html 이 없습니다.' } });
    }

    // staging prefix — 이전 보류 업데이트가 있으면 먼저 비움
    const stagingPath = `games-staging/${slug}/`;
    try { await r2.deletePrefix(stagingPath); } catch (e) { console.error('r2 stage clear:', e.message); }

    let uploadedBytes = 0;
    for (const entry of entries) {
      let rel = entry.name;
      if (rootPrefix && rel.startsWith(rootPrefix)) rel = rel.slice(rootPrefix.length);
      if (rel.includes('..') || rel.startsWith('/')) continue;
      const data = entry.raw.getData();
      uploadedBytes += data.length;
      await r2.putObject(`${stagingPath}${rel}`, data);
    }

    const updated = await prisma.game.update({
      where: { slug },
      data: {
        pendingStoragePath: stagingPath,
        pendingVersion: g.version + 1,
        pendingUploadedAt: new Date(),
        pendingRejectReason: null,
      },
    });

    res.status(202).json({
      ok: true,
      pending: true,
      game: {
        slug: updated.slug,
        version: updated.version,
        pendingVersion: updated.pendingVersion,
        uploadedBytes,
      },
      message: '검수 대기 큐에 올렸습니다. 운영자 승인 후 라이브로 반영됩니다.',
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: { message: `파일이 너무 큽니다 (최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).` } });
    }
    console.error('reupload error:', err);
    next(err);
  }
});

/**
 * GET /api/games/mine — 내가 owner 로 등록된 게임 목록 (모든 status).
 * official 게임도 본인이 owner 면 표시됨.
 */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const games = await prisma.game.findMany({
      where: { ownerUserId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ games });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  emoji: z.string().max(16).optional(),
  category: z.enum(['earn', 'multiplay', 'decorate', 'other']).optional(),
  tags: z.array(z.string()).optional(),
});

router.patch('/:slug', requireAuth, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (g.ownerUserId !== req.user.id && !req.user.isOperator) {
      return res.status(403).json({ error: { message: '권한이 없습니다.' } });
    }
    const data = patchSchema.parse(req.body);
    const updated = await prisma.game.update({ where: { slug }, data });
    res.json({ game: updated });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 검증 실패' } });
    }
    next(err);
  }
});

router.delete('/:slug', requireAuth, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    const isOwner = g.ownerUserId && g.ownerUserId === req.user.id;
    const isOperator = !!req.user.isOperator;
    if (!isOwner && !isOperator) {
      return res.status(403).json({ error: { message: '권한이 없습니다.' } });
    }
    // official 게임은 운영자만 삭제 가능 (실수 방지)
    if (g.kind === 'official' && !isOperator) {
      return res.status(403).json({ error: { message: '공식 게임은 운영자만 삭제할 수 있습니다.' } });
    }
    // R2 파일들도 정리 (production + staging 모두)
    try { await r2.deletePrefix(g.storagePath); } catch (e) { console.error('r2 delete prod:', e.message); }
    if (g.pendingStoragePath) {
      try { await r2.deletePrefix(g.pendingStoragePath); } catch (e) { console.error('r2 delete staging:', e.message); }
    }
    await prisma.game.delete({ where: { slug } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ── 운영자 ────────────────────────────────────────────────── */

const operatorRouter = Router();

operatorRouter.get('/pending', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const games = await prisma.game.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ games });
  } catch (err) { next(err); }
});

operatorRouter.post('/:slug/approve', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    const updated = await prisma.game.update({
      where: { slug },
      data: { status: 'published', publishedAt: new Date(), rejectReason: null },
    });
    res.json({ game: updated });
  } catch (err) { next(err); }
});

const rejectSchema = z.object({ reason: z.string().min(1).max(500) });
operatorRouter.post('/:slug/reject', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const { reason } = rejectSchema.parse(req.body);
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    const updated = await prisma.game.update({
      where: { slug },
      data: { status: 'rejected', rejectReason: reason },
    });
    res.json({ game: updated });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: '거절 사유 필요' } });
    }
    next(err);
  }
});

operatorRouter.post('/:slug/hide', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const updated = await prisma.game.update({
      where: { slug },
      data: { status: 'hidden' },
    });
    res.json({ game: updated });
  } catch (err) { next(err); }
});

/**
 * GET /api/operator/games/pending-updates — 검수 대기 중인 재업로드 목록.
 */
operatorRouter.get('/pending-updates', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const games = await prisma.game.findMany({
      where: { pendingStoragePath: { not: null } },
      orderBy: { pendingUploadedAt: 'asc' },
    });
    res.json({ games });
  } catch (err) { next(err); }
});

/**
 * POST /api/operator/games/:slug/approve-update — 보류 zip 을 production 으로 교체.
 * staging → production 복사 후 staging 비움. version = pendingVersion.
 */
operatorRouter.post('/:slug/approve-update', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (!g.pendingStoragePath) {
      return res.status(400).json({ error: { message: '보류 중인 업데이트가 없습니다.' } });
    }

    // 1) production 비우기 (orphan 방지)
    try { await r2.deletePrefix(g.storagePath); } catch (e) { console.error('r2 prod clear:', e.message); }
    // 2) staging → production 복사
    try {
      await r2.copyPrefix(g.pendingStoragePath, g.storagePath);
    } catch (e) {
      console.error('r2 copy staging→prod:', e);
      return res.status(500).json({ error: { message: 'staging → production 복사 실패' } });
    }
    // 3) staging 비우기
    try { await r2.deletePrefix(g.pendingStoragePath); } catch (e) { console.error('r2 stage clear:', e.message); }

    // 4) DB 반영
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        version: g.pendingVersion ?? g.version + 1,
        pendingStoragePath: null,
        pendingVersion: null,
        pendingUploadedAt: null,
        pendingRejectReason: null,
        updatedAt: new Date(),
      },
    });
    res.json({ ok: true, game: updated, message: '업데이트가 라이브에 반영됐습니다.' });
  } catch (err) { next(err); }
});

/**
 * POST /api/operator/games/:slug/reject-update — 보류 zip 폐기.
 */
const rejectUpdateSchema = z.object({ reason: z.string().min(1).max(500) });
operatorRouter.post('/:slug/reject-update', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const { reason } = rejectUpdateSchema.parse(req.body);
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (!g.pendingStoragePath) {
      return res.status(400).json({ error: { message: '보류 중인 업데이트가 없습니다.' } });
    }

    try { await r2.deletePrefix(g.pendingStoragePath); } catch (e) { console.error('r2 stage clear:', e.message); }
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        pendingStoragePath: null,
        pendingVersion: null,
        pendingUploadedAt: null,
        pendingRejectReason: reason,
      },
    });
    res.json({ ok: true, game: updated });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: '거절 사유 필요' } });
    }
    next(err);
  }
});

/**
 * GET /api/operator/games/all — 모든 게임 목록 (상태·종류 무관, 관리용).
 */
operatorRouter.get('/all', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const games = await prisma.game.findMany({
      orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ games });
  } catch (err) { next(err); }
});

module.exports = { router, operatorRouter };
