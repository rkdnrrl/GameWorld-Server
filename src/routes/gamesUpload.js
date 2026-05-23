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

const MAX_UPLOAD_BYTES    = 50  * 1024 * 1024; // 50MB (zip)
const MAX_THUMBNAIL_BYTES = 5   * 1024 * 1024; // 5MB
const MAX_VIDEO_BYTES     = 200 * 1024 * 1024; // 200MB
const MAX_FILES = 500;
const ALLOWED_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['admin', 'api', 'operator', 'develop', 'games', 'auth', 'login', 'signup', 'play']);

const CDN_BASE = 'https://play.airliveplay.com';
const IMG_MIME = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);
const VID_MIME = new Map([['video/mp4','mp4'],['video/webm','webm']]);

// zip 단독 (제한 50MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

// zip + 미디어 (파일당 200MB, 최대 3개)
const uploadMulti = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 3 },
});

// 운영자 전용 — 파일 크기 제한 없음
const uploadUnlimited = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1 },
});

// 미디어 전용 (썸네일 + 영상 + 스크린샷)
const uploadMediaOnly = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 7 },
});

/** staging URL → R2 key */
function urlToKey(url) { return url.replace(`${CDN_BASE}/`, ''); }
/** staging key → live key (media/staging/... → media/...) */
function stagingToLiveKey(key) { return key.replace('media/staging/', 'media/'); }

/** staging R2에 미디어 업로드 → pendingXxx URL 반환 */
async function saveMediaStaging(slug, files) {
  const result = {};
  const th = files?.thumbnail?.[0];
  const vd = files?.demoVideo?.[0];
  if (th && IMG_MIME.has(th.mimetype) && th.size <= MAX_THUMBNAIL_BYTES) {
    const key = `media/staging/thumbnails/${slug}.${IMG_MIME.get(th.mimetype)}`;
    await r2.putObject(key, th.buffer, { contentType: th.mimetype });
    result.pendingThumbnailUrl = `${CDN_BASE}/${key}`;
  }
  if (vd && VID_MIME.has(vd.mimetype) && vd.size <= MAX_VIDEO_BYTES) {
    const key = `media/staging/videos/${slug}.${VID_MIME.get(vd.mimetype)}`;
    await r2.putObject(key, vd.buffer, { contentType: vd.mimetype });
    result.pendingDemoVideoUrl = `${CDN_BASE}/${key}`;
  }
  const ssFiles = files?.screenshots ?? [];
  if (ssFiles.length > 0) {
    const urls = [];
    for (let i = 0; i < ssFiles.length; i++) {
      const ss = ssFiles[i];
      if (IMG_MIME.has(ss.mimetype) && ss.size <= MAX_THUMBNAIL_BYTES) {
        const key = `media/staging/screenshots/${slug}-${i}.${IMG_MIME.get(ss.mimetype)}`;
        await r2.putObject(key, ss.buffer, { contentType: ss.mimetype });
        urls.push(`${CDN_BASE}/${key}`);
      }
    }
    if (urls.length > 0) result.pendingScreenshots = urls;
  }
  return result;
}

/** staging 미디어를 live로 복사. live DB 필드값 반환 */
async function applyPendingMedia(g) {
  const liveData = {};
  async function moveFile(stagingUrl, liveField) {
    if (!stagingUrl) return;
    const sk = urlToKey(stagingUrl);
    const lk = stagingToLiveKey(sk);
    const data = await r2.getObject(sk);
    await r2.putObject(lk, data);
    try { await r2.deleteKeys([sk]); } catch {}
    liveData[liveField] = `${CDN_BASE}/${lk}`;
  }
  await moveFile(g.pendingThumbnailUrl, 'thumbnailUrl');
  await moveFile(g.pendingDemoVideoUrl, 'demoVideoUrl');
  if (Array.isArray(g.pendingScreenshots) && g.pendingScreenshots.length > 0) {
    const urls = [];
    for (const su of g.pendingScreenshots) {
      const sk = urlToKey(su);
      const lk = stagingToLiveKey(sk);
      const data = await r2.getObject(sk);
      await r2.putObject(lk, data);
      try { await r2.deleteKeys([sk]); } catch {}
      urls.push(`${CDN_BASE}/${lk}`);
    }
    liveData.screenshots = urls;
  }
  return liveData;
}

/** staging 미디어 파일 R2에서 삭제 */
async function deletePendingMediaFiles(g) {
  const toDelete = [];
  if (g.pendingThumbnailUrl) toDelete.push(urlToKey(g.pendingThumbnailUrl));
  if (g.pendingDemoVideoUrl) toDelete.push(urlToKey(g.pendingDemoVideoUrl));
  if (Array.isArray(g.pendingScreenshots)) {
    for (const su of g.pendingScreenshots) toDelete.push(urlToKey(su));
  }
  if (toDelete.length > 0) {
    try { await r2.deleteKeys(toDelete); } catch (e) { console.error('media staging delete:', e.message); }
  }
}

/** R2에 미디어 업로드 후 URL 반환. files = req.files 객체 */
async function saveMedia(slug, files) {
  const result = {};
  const th = files?.thumbnail?.[0];
  const vd = files?.demoVideo?.[0];
  if (th && IMG_MIME.has(th.mimetype) && th.size <= MAX_THUMBNAIL_BYTES) {
    const key = `media/thumbnails/${slug}.${IMG_MIME.get(th.mimetype)}`;
    await r2.putObject(key, th.buffer, { contentType: th.mimetype });
    result.thumbnailUrl = `${CDN_BASE}/${key}`;
  }
  if (vd && VID_MIME.has(vd.mimetype) && vd.size <= MAX_VIDEO_BYTES) {
    const key = `media/videos/${slug}.${VID_MIME.get(vd.mimetype)}`;
    await r2.putObject(key, vd.buffer, { contentType: vd.mimetype });
    result.demoVideoUrl = `${CDN_BASE}/${key}`;
  }
  const ssFiles = files?.screenshots ?? [];
  if (ssFiles.length > 0) {
    const urls = [];
    for (let i = 0; i < ssFiles.length; i++) {
      const ss = ssFiles[i];
      if (IMG_MIME.has(ss.mimetype) && ss.size <= MAX_THUMBNAIL_BYTES) {
        const key = `media/screenshots/${slug}-${i}.${IMG_MIME.get(ss.mimetype)}`;
        await r2.putObject(key, ss.buffer, { contentType: ss.mimetype });
        urls.push(`${CDN_BASE}/${key}`);
      }
    }
    if (urls.length > 0) result.screenshots = urls;
  }
  return result;
}

const i18nSchema = z.record(z.string().max(30)).optional();
const uploadSchema = z.object({
  slug: z.string().min(2).max(60).regex(ALLOWED_SLUG_RE, 'slug 형식 잘못됨 (소문자/숫자/하이픈)'),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  emoji: z.string().max(16).optional().default('🎮'),
  category: z.string().max(30).optional().default('other'),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  titlesI18n: i18nSchema,
  descriptionsI18n: i18nSchema,
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
const UPLOAD_FIELDS = [
  { name: 'gamezip',     maxCount: 1 },
  { name: 'thumbnail',   maxCount: 1 },
  { name: 'demoVideo',   maxCount: 1 },
  { name: 'screenshots', maxCount: 5 },
];

router.post('/upload', requireAuth, uploadMulti.fields(UPLOAD_FIELDS), async (req, res, next) => {
  try {
    const zipFile = req.files?.gamezip?.[0];
    if (!zipFile) return res.status(400).json({ error: { message: 'gamezip 파일 필요' } });
    // req.file 을 zipFile 로 대체 — 아래 코드 호환을 위해 주입
    req.file = zipFile;

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

    // 미디어 업로드 (썸네일, 데모영상)
    const media = await saveMedia(slug, req.files).catch(() => ({}));

    // DB INSERT
    const game = await prisma.game.create({
      data: {
        slug,
        ownerUserId: req.user.id,
        title: parsed.title,
        description: parsed.description,
        emoji: parsed.emoji || '🎮',
        kind: 'community',
        status: 'pending',
        category: parsed.category,
        storagePath,
        tags: tags.length > 0 ? tags : undefined,
        version: 1,
        ...media,
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
router.post('/:slug/files', requireAuth, uploadMulti.fields(UPLOAD_FIELDS), async (req, res, next) => {
  try {
    const zipFile = req.files?.gamezip?.[0];
    if (!zipFile) return res.status(400).json({ error: { message: 'gamezip 파일 필요' } });
    req.file = zipFile;
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

    // 미디어도 staging으로 — zip 승인 시 함께 live 반영
    const media = await saveMediaStaging(slug, req.files).catch(() => ({}));
    const hasMedia = Object.keys(media).length > 0;

    const updated = await prisma.game.update({
      where: { slug },
      data: {
        pendingStoragePath: stagingPath,
        pendingVersion: g.version + 1,
        pendingUploadedAt: new Date(),
        pendingRejectReason: null,
        ...(hasMedia ? { ...media, pendingMediaAt: new Date(), pendingMediaRejectReason: null } : {}),
      },
    });

    logActivity(req.user, 'game_update', { slug: updated.slug, title: g.title, pendingVersion: updated.pendingVersion });

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
 * GET /api/games/mine/stats — 내 게임 전체 통계 (플레이·좋아요·평점·댓글).
 */
router.get('/mine/stats', requireAuth, async (req, res, next) => {
  try {
    const games = await prisma.game.findMany({
      where: { ownerUserId: req.user.id },
      orderBy: { playCount: 'desc' },
      select: {
        slug: true, title: true, emoji: true, category: true, status: true,
        thumbnailUrl: true, playCount: true, likeCount: true, publishedAt: true,
        _count: { select: { ratings: true, comments: true } },
      },
    });

    const slugs = games.map((g) => g.slug);
    const ratingRows = slugs.length > 0
      ? await prisma.gameRating.groupBy({
          by: ['gameSlug'],
          where: { gameSlug: { in: slugs } },
          _avg: { rating: true },
          _count: { rating: true },
        })
      : [];
    const rMap = new Map(ratingRows.map((r) => [
      r.gameSlug,
      { avg: Math.round((r._avg.rating ?? 0) * 10) / 10, count: r._count.rating },
    ]));

    const result = games.map((g) => ({
      slug:         g.slug,
      title:        g.title,
      emoji:        g.emoji,
      category:     g.category,
      status:       g.status,
      thumbnailUrl: g.thumbnailUrl,
      playCount:    g.playCount,
      likeCount:    g.likeCount,
      ratingAvg:    rMap.get(g.slug)?.avg   ?? 0,
      ratingCount:  rMap.get(g.slug)?.count ?? 0,
      commentCount: g._count.comments,
      publishedAt:  g.publishedAt,
    }));

    const summary = {
      totalGames:     games.length,
      publishedGames: games.filter((g) => g.status === 'published').length,
      totalPlays:     games.reduce((s, g) => s + g.playCount, 0),
      totalLikes:     games.reduce((s, g) => s + g.likeCount, 0),
      totalRatings:   [...rMap.values()].reduce((s, r) => s + r.count, 0),
      totalComments:  games.reduce((s, g) => s + g._count.comments, 0),
    };

    res.json({ summary, games: result });
  } catch (err) { next(err); }
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
  category: z.string().max(30).optional(),
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

/**
 * POST /api/games/:slug/media — 썸네일/데모영상/스크린샷 단독 업데이트 (zip 불필요).
 * 운영자: 즉시 live 반영.
 * 일반 유저: staging 저장 → 운영자 검수 후 반영.
 */
router.post('/:slug/media', requireAuth, uploadMediaOnly.fields([
  { name: 'thumbnail',   maxCount: 1 },
  { name: 'demoVideo',   maxCount: 1 },
  { name: 'screenshots', maxCount: 5 },
]), async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g    = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (g.ownerUserId !== req.user.id && !req.user.isOperator) {
      return res.status(403).json({ error: { message: '권한이 없습니다.' } });
    }

    // 운영자는 바로 live 반영
    if (req.user.isOperator) {
      const media = await saveMedia(slug, req.files);
      if (Object.keys(media).length === 0) {
        return res.status(400).json({ error: { message: '파일을 첨부해주세요.' } });
      }
      const updated = await prisma.game.update({ where: { slug }, data: media });
      return res.json({ ok: true, instant: true, game: { thumbnailUrl: updated.thumbnailUrl, demoVideoUrl: updated.demoVideoUrl } });
    }

    // 일반 유저: staging → 검수 대기
    const media = await saveMediaStaging(slug, req.files);
    if (Object.keys(media).length === 0) {
      return res.status(400).json({ error: { message: '썸네일(JPG/PNG/WebP 5MB↓) 또는 영상(MP4/WebM 200MB↓)을 첨부해주세요.' } });
    }
    const updated = await prisma.game.update({
      where: { slug },
      data: { ...media, pendingMediaAt: new Date(), pendingMediaRejectReason: null },
    });
    res.json({ ok: true, pending: true, game: { pendingThumbnailUrl: updated.pendingThumbnailUrl } });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/games/:slug/pending-media — 대기 중인 미디어 취소 (owner/operator).
 */
router.delete('/:slug/pending-media', requireAuth, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    const isOwner = g.ownerUserId && g.ownerUserId === req.user.id;
    if (!isOwner && !req.user.isOperator) {
      return res.status(403).json({ error: { message: '권한이 없습니다.' } });
    }
    await deletePendingMediaFiles(g);
    await prisma.game.update({
      where: { slug },
      data: { pendingThumbnailUrl: null, pendingDemoVideoUrl: null, pendingScreenshots: null, pendingMediaAt: null, pendingMediaRejectReason: null },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/games/:slug/pending-update — 보류 중인 업데이트 취소 (owner/operator).
 * staging R2 파일 삭제 + pending 필드 초기화. 라이브 버전은 유지.
 */
router.delete('/:slug/pending-update', requireAuth, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });

    const isOwner = g.ownerUserId && g.ownerUserId === req.user.id;
    if (!isOwner && !req.user.isOperator) {
      return res.status(403).json({ error: { message: '권한이 없습니다.' } });
    }
    if (!g.pendingStoragePath) {
      return res.status(400).json({ error: { message: '취소할 업데이트가 없습니다.' } });
    }

    try { await r2.deletePrefix(g.pendingStoragePath); } catch (e) { console.error('r2 stage clear:', e.message); }

    const updated = await prisma.game.update({
      where: { slug },
      data: { pendingStoragePath: null, pendingVersion: null, pendingUploadedAt: null, pendingRejectReason: null },
    });
    logActivity(req.user, 'game_update_cancel', { slug: updated.slug, title: updated.title });
    res.json({ ok: true, game: updated });
  } catch (err) {
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
    logActivity(req.user, 'game_delete', { slug: g.slug, title: g.title, kind: g.kind });
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
    logActivity(req.user, 'game_approve', { slug: updated.slug, title: updated.title });
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
    logActivity(req.user, 'game_reject', { slug: updated.slug, title: updated.title, reason });
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
    logActivity(req.user, 'game_hide', { slug: updated.slug, title: updated.title });
    res.json({ game: updated });
  } catch (err) { next(err); }
});

/**
 * POST /api/operator/games/:slug/unhide — 비공개 → 공개 (published) 복원
 */
operatorRouter.post('/:slug/unhide', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const updated = await prisma.game.update({
      where: { slug },
      data: { status: 'published', publishedAt: new Date() },
    });
    logActivity(req.user, 'game_unhide', { slug: updated.slug, title: updated.title });
    res.json({ game: updated });
  } catch (err) { next(err); }
});

/**
 * POST /api/operator/games/:slug/set-kind — community ↔ official 전환
 */
operatorRouter.post('/:slug/set-kind', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const { kind } = req.body;
    if (kind !== 'official' && kind !== 'community') {
      return res.status(400).json({ error: { message: 'kind는 official 또는 community 만 허용됩니다.' } });
    }
    const updated = await prisma.game.update({ where: { slug }, data: { kind } });
    logActivity(req.user, 'game_set_kind', { slug: updated.slug, title: updated.title, kind });
    res.json({ ok: true, game: updated });
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

    // 1) staging 파일 목록 확인 — 비어 있으면 에러
    const stagingKeys = await r2.listObjects(g.pendingStoragePath);
    if (stagingKeys.length === 0) {
      return res.status(400).json({ error: { message: '스테이징에 파일이 없습니다. 다시 업로드해주세요.' } });
    }

    // 2) staging → production 복사 (기존 production 파일 덮어쓰기)
    //    production 을 먼저 지우지 않으므로, 복사 실패 시 기존 파일 유지
    const stagingRelPaths = new Set(stagingKeys.map((k) => k.slice(g.pendingStoragePath.length)));
    for (const key of stagingKeys) {
      const rel     = key.slice(g.pendingStoragePath.length);
      const dstKey  = g.storagePath + rel;
      const data    = await r2.getObject(key);
      await r2.putObject(dstKey, data);
    }

    // 3) production 에서 새 버전에 없는 파일(orphan) 삭제
    const prodKeys   = await r2.listObjects(g.storagePath);
    const orphanKeys = prodKeys.filter((k) => !stagingRelPaths.has(k.slice(g.storagePath.length)));
    if (orphanKeys.length > 0) {
      await r2.deleteKeys(orphanKeys);
    }

    // 4) 함께 대기 중인 미디어가 있으면 live로 이동
    const liveMedia = await applyPendingMedia(g).catch(() => ({}));

    // 5) DB 반영 (복사 완료 후에만)
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        version: g.pendingVersion ?? g.version + 1,
        pendingStoragePath: null,
        pendingVersion: null,
        pendingUploadedAt: null,
        pendingRejectReason: null,
        pendingThumbnailUrl: null,
        pendingDemoVideoUrl: null,
        pendingScreenshots: null,
        pendingMediaAt: null,
        pendingMediaRejectReason: null,
        ...liveMedia,
        updatedAt: new Date(),
      },
    });

    // 6) staging 정리 (cleanup — 실패해도 무방)
    try { await r2.deletePrefix(g.pendingStoragePath); } catch (e) { console.error('r2 stage clear:', e.message); }

    logActivity(req.user, 'game_update_approve', { slug: updated.slug, title: updated.title, version: updated.version });
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
    await deletePendingMediaFiles(g);
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        pendingStoragePath: null,
        pendingVersion: null,
        pendingUploadedAt: null,
        pendingRejectReason: reason,
        pendingThumbnailUrl: null,
        pendingDemoVideoUrl: null,
        pendingScreenshots: null,
        pendingMediaAt: null,
        pendingMediaRejectReason: null,
      },
    });
    logActivity(req.user, 'game_update_reject', { slug: updated.slug, title: updated.title, reason });
    res.json({ ok: true, game: updated });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: '거절 사유 필요' } });
    }
    next(err);
  }
});

/**
 * GET /api/operator/games/:slug/download — 게임 파일 전체를 zip으로 다운로드.
 */
operatorRouter.get('/:slug/download', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });

    const keys = await r2.listObjects(g.storagePath);
    if (keys.length === 0) return res.status(404).json({ error: { message: '게임 파일이 없습니다.' } });

    const zip = new AdmZip();
    for (const key of keys) {
      const rel = key.slice(g.storagePath.length); // 'games/{slug}/' 이후 상대경로
      if (!rel) continue;
      const data = await r2.getObject(key);
      zip.addFile(rel, data);
    }

    const buf = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (err) {
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

/**
 * POST /api/operator/games/:slug/feature — 피처드 게임 설정 (나머지는 해제)
 */
operatorRouter.post('/:slug/feature', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const featuredText = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 300) : undefined;
    const featuredTextX = typeof req.body.x === 'number' ? Math.max(0, Math.min(100, req.body.x)) : undefined;
    const featuredTextY = typeof req.body.y === 'number' ? Math.max(0, Math.min(100, req.body.y)) : undefined;
    const featuredTextsI18n = req.body.textsI18n && typeof req.body.textsI18n === 'object' ? req.body.textsI18n : undefined;
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        isFeatured: true,
        ...(featuredText !== undefined && { featuredText }),
        ...(featuredTextX !== undefined && { featuredTextX }),
        ...(featuredTextY !== undefined && { featuredTextY }),
        ...(featuredTextsI18n !== undefined && { featuredTextsI18n }),
      },
    });
    res.json({ ok: true, slug: updated.slug, isFeatured: updated.isFeatured });
  } catch (err) { next(err); }
});

/**
 * GET /api/operator/games/pending-media — 미디어 단독 검수 대기 목록
 * (zip 없이 썸네일/영상만 수정 신청한 것)
 */
operatorRouter.get('/pending-media', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const games = await prisma.game.findMany({
      where: { pendingMediaAt: { not: null }, pendingStoragePath: null },
      orderBy: { pendingMediaAt: 'asc' },
    });
    res.json({ games });
  } catch (err) { next(err); }
});

/**
 * POST /api/operator/games/:slug/approve-media — staging 미디어 → live 반영
 */
operatorRouter.post('/:slug/approve-media', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (!g.pendingMediaAt) {
      return res.status(400).json({ error: { message: '대기 중인 미디어 업데이트가 없습니다.' } });
    }
    const liveMedia = await applyPendingMedia(g);
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        ...liveMedia,
        pendingThumbnailUrl: null,
        pendingDemoVideoUrl: null,
        pendingScreenshots: null,
        pendingMediaAt: null,
        pendingMediaRejectReason: null,
      },
    });
    logActivity(req.user, 'game_media_approve', { slug: updated.slug, title: updated.title });
    res.json({ ok: true, game: updated });
  } catch (err) { next(err); }
});

/**
 * POST /api/operator/games/:slug/reject-media — staging 미디어 폐기
 */
const rejectMediaSchema = z.object({ reason: z.string().min(1).max(500) });
operatorRouter.post('/:slug/reject-media', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const { reason } = rejectMediaSchema.parse(req.body);
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (!g.pendingMediaAt) {
      return res.status(400).json({ error: { message: '대기 중인 미디어 업데이트가 없습니다.' } });
    }
    await deletePendingMediaFiles(g);
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        pendingThumbnailUrl: null,
        pendingDemoVideoUrl: null,
        pendingScreenshots: null,
        pendingMediaAt: null,
        pendingMediaRejectReason: reason,
      },
    });
    logActivity(req.user, 'game_media_reject', { slug: updated.slug, title: updated.title, reason });
    res.json({ ok: true, game: updated });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: '거절 사유 필요' } });
    }
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════
   메타데이터 수정 검수 흐름
   ═══════════════════════════════════════════════════════════ */
const metaSchema = z.object({
  title:            z.string().min(1).max(120).optional(),
  description:      z.string().max(2000).optional(),
  emoji:            z.string().max(16).optional(),
  category:         z.string().max(30).optional(),
  tags:             z.array(z.string().max(30)).max(10).optional(),
  titlesI18n:       z.record(z.string()).optional(),
  descriptionsI18n: z.record(z.string()).optional(),
});
const rejectMetaSchema = z.object({ reason: z.string().min(1).max(500) });

/**
 * PATCH /api/games/:slug/pending-meta — 유저가 메타데이터 수정 신청 (검수 대기 등록)
 */
router.patch('/:slug/pending-meta', requireAuth, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (g.ownerUserId !== req.user.id) {
      return res.status(403).json({ error: { message: '권한이 없습니다.' } });
    }
    const data = metaSchema.parse(req.body);
    if (!Object.keys(data).length) {
      return res.status(400).json({ error: { message: '변경할 내용이 없습니다.' } });
    }
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        pendingTitle:            data.title            ?? null,
        pendingDescription:      data.description      ?? null,
        pendingEmoji:            data.emoji            ?? null,
        pendingCategory:         data.category         ?? null,
        pendingTags:             data.tags             ?? null,
        pendingTitlesI18n:       data.titlesI18n       ?? null,
        pendingDescriptionsI18n: data.descriptionsI18n ?? null,
        pendingMetaAt:           new Date(),
        pendingMetaRejectReason: null,
      },
    });
    res.json({ ok: true, game: updated });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 오류' } });
    next(err);
  }
});

/**
 * DELETE /api/games/:slug/pending-meta — 유저가 메타 수정 신청 취소
 */
router.delete('/:slug/pending-meta', requireAuth, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (g.ownerUserId !== req.user.id && !req.user.isOperator) {
      return res.status(403).json({ error: { message: '권한이 없습니다.' } });
    }
    const updated = await prisma.game.update({
      where: { slug },
      data: { pendingTitle: null, pendingDescription: null, pendingEmoji: null, pendingCategory: null, pendingTags: null, pendingTitlesI18n: null, pendingDescriptionsI18n: null, pendingMetaAt: null, pendingMetaRejectReason: null },
    });
    res.json({ ok: true, game: updated });
  } catch (err) { next(err); }
});

/**
 * GET /api/operator/games/pending-meta — 메타 검수 대기 목록
 */
operatorRouter.get('/pending-meta', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const games = await prisma.game.findMany({
      where: { pendingMetaAt: { not: null } },
      include: { owner: { select: { nickname: true } } },
      orderBy: { pendingMetaAt: 'asc' },
    });
    res.json({ games });
  } catch (err) { next(err); }
});

/**
 * POST /api/operator/games/:slug/approve-meta — 메타 수정 승인 (pending → live)
 */
operatorRouter.post('/:slug/approve-meta', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (!g.pendingMetaAt) return res.status(400).json({ error: { message: '대기 중인 메타 수정이 없습니다.' } });
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        title:            g.pendingTitle            ?? g.title,
        description:      g.pendingDescription      ?? g.description,
        emoji:            g.pendingEmoji            ?? g.emoji,
        category:         g.pendingCategory         ?? g.category,
        tags:             g.pendingTags             ?? g.tags,
        titlesI18n:       g.pendingTitlesI18n       ?? g.titlesI18n,
        descriptionsI18n: g.pendingDescriptionsI18n ?? g.descriptionsI18n,
        pendingTitle: null, pendingDescription: null, pendingEmoji: null,
        pendingCategory: null, pendingTags: null,
        pendingTitlesI18n: null, pendingDescriptionsI18n: null,
        pendingMetaAt: null, pendingMetaRejectReason: null,
      },
    });
    logActivity(req.user, 'game_meta_approve', { slug: updated.slug, title: updated.title });
    res.json({ ok: true, game: updated });
  } catch (err) { next(err); }
});

/**
 * POST /api/operator/games/:slug/reject-meta — 메타 수정 거부
 */
operatorRouter.post('/:slug/reject-meta', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const { reason } = rejectMetaSchema.parse(req.body);
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    if (!g.pendingMetaAt) return res.status(400).json({ error: { message: '대기 중인 메타 수정이 없습니다.' } });
    const updated = await prisma.game.update({
      where: { slug },
      data: {
        pendingTitle: null, pendingDescription: null, pendingEmoji: null,
        pendingCategory: null, pendingTags: null,
        pendingTitlesI18n: null, pendingDescriptionsI18n: null,
        pendingMetaAt: null, pendingMetaRejectReason: reason,
      },
    });
    logActivity(req.user, 'game_meta_reject', { slug: updated.slug, title: updated.title, reason });
    res.json({ ok: true, game: updated });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: { message: '거절 사유 필요' } });
    next(err);
  }
});

/**
 * PATCH /api/operator/games/:slug/meta — 운영자 직접 메타 수정 (검수 없이 즉시 반영)
 */
operatorRouter.patch('/:slug/meta', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const g = await prisma.game.findUnique({ where: { slug } });
    if (!g) return res.status(404).json({ error: { message: '게임을 찾을 수 없습니다.' } });
    const data = metaSchema.parse(req.body);
    if (!Object.keys(data).length) return res.status(400).json({ error: { message: '변경할 내용이 없습니다.' } });
    const updated = await prisma.game.update({ where: { slug }, data });
    logActivity(req.user, 'game_meta_operator_edit', { slug: updated.slug, title: updated.title });
    res.json({ ok: true, game: updated });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 오류' } });
    next(err);
  }
});

/**
 * DELETE /api/operator/games/:slug/feature — 피처드 해제
 */
operatorRouter.delete('/:slug/feature', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    await prisma.game.update({ where: { slug }, data: { isFeatured: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router, operatorRouter };
