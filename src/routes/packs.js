/**
 * 폴더 팩 (Folder Packs) — 폴더를 발행 단위로 묶음
 *   GET    /api/packs/my            — 내 팩 목록 (private+public)
 *   GET    /api/packs/public        — 마켓플레이스 (검색·페이지·정렬)
 *   GET    /api/packs/:id           — 팩 상세 (작가 + 안의 에셋 목록)
 *   PUT    /api/packs               — upsert (creatorId+path)
 *   DELETE /api/packs/:id           — 팩 메타만 삭제 (에셋은 그대로)
 *   POST   /api/packs/:id/import    — 팩 안의 모든 에셋 clone (폴더 구조 유지)
 *
 * 정규화 규칙:
 *   - path 는 normalizeFolder 거친 절대 경로 ("/캐릭터")
 *   - 루트("/") 는 팩 불가 — 너무 광범위
 */
const { Router } = require('express');
const path = require('path');
const { prisma } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const r2 = require('../lib/r2');

const router = Router();
const CDN_BASE = 'https://play.airliveplay.com';
const PAGE_SIZE_DEFAULT = 24;
const PAGE_SIZE_MAX     = 60;

/** path 정규화 — frontend 의 normalizeFolder 와 동일 규칙 */
function normalizePath(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let p = '/' + s.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (p === '/') return null;
  const segs = p.slice(1).split('/').map(seg => seg.trim().slice(0, 50)).filter(Boolean);
  if (segs.length === 0 || segs.length > 8) return null;
  return '/' + segs.join('/');
}

function serializeAsset(a) {
  if (!a) return a;
  return { ...a, fileSize: a.fileSize != null ? a.fileSize.toString() : null };
}

/** 팩에 포함된 에셋 — folder 가 정확히 같거나 하위 */
function packAssetsWhere(creatorId, packPath, includePrivate = false) {
  const where = {
    creatorId,
    OR: [
      { folder: packPath },
      { folder: { startsWith: packPath + '/' } },
    ],
  };
  if (!includePrivate) where.isPublic = true;
  return where;
}

/* ─────────────────────────────────────────
   GET /api/packs/my — 내 팩 목록
───────────────────────────────────────── */
router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const packs = await prisma.folderPack.findMany({
      where:   { creatorId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      take:    200,
    });
    // 각 팩의 에셋 수 카운트 (현재 시점)
    const withCounts = await Promise.all(packs.map(async p => {
      const count = await prisma.asset.count({ where: packAssetsWhere(req.user.id, p.path, true) });
      return { ...p, assetCount: count };
    }));
    res.json({ packs: withCounts });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   GET /api/packs/public — 마켓 (검색·페이지·정렬)
───────────────────────────────────────── */
router.get('/public', async (req, res, next) => {
  try {
    const q        = String(req.query.q || '').trim();
    const sort     = String(req.query.sort || 'recent');
    const page     = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX,
      Math.max(1, parseInt(String(req.query.pageSize || PAGE_SIZE_DEFAULT)) || PAGE_SIZE_DEFAULT),
    );

    const where = { isPublic: true };
    if (q) {
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { path:        { contains: q, mode: 'insensitive' } },
      ];
    }
    const orderBy =
      sort === 'popular' ? [{ importCount: 'desc' }, { createdAt: 'desc' }] :
                           [{ createdAt: 'desc' }];

    const [total, packs] = await Promise.all([
      prisma.folderPack.count({ where }),
      prisma.folderPack.findMany({
        where, orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // 각 팩의 작가명 + 커버 썸네일 + 에셋 수
    const enriched = await Promise.all(packs.map(async p => {
      const [creator, assetCount, cover] = await Promise.all([
        prisma.profile.findUnique({ where: { id: p.creatorId }, select: { username: true } }),
        prisma.asset.count({ where: packAssetsWhere(p.creatorId, p.path, false) }),
        p.coverAssetId
          ? prisma.asset.findUnique({ where: { id: p.coverAssetId }, select: { modelUrl: true, thumbnailUrl: true, kind: true } })
          : null,
      ]);
      return { ...p, creator, assetCount, cover };
    }));

    res.json({ packs: enriched, page, pageSize, total, hasMore: page * pageSize < total });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   GET /api/packs/:id — 팩 상세 (안의 공개 에셋들 포함)
───────────────────────────────────────── */
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const pack = await prisma.folderPack.findUnique({ where: { id: req.params.id } });
    if (!pack) return res.status(404).json({ error: { message: '팩 없음' } });

    const isOwner = !!req.user && req.user.id === pack.creatorId;
    if (!pack.isPublic && !isOwner) {
      return res.status(403).json({ error: { message: '비공개 팩' } });
    }

    const [creator, assets, cover] = await Promise.all([
      prisma.profile.findUnique({ where: { id: pack.creatorId }, select: { username: true } }),
      prisma.asset.findMany({
        where:   packAssetsWhere(pack.creatorId, pack.path, isOwner /* 본인이면 비공개도 */),
        orderBy: { createdAt: 'desc' },
      }),
      pack.coverAssetId
        ? prisma.asset.findUnique({ where: { id: pack.coverAssetId } })
        : null,
    ]);

    res.json({
      pack: { ...pack, creator, cover: cover ? serializeAsset(cover) : null },
      assets: assets.map(serializeAsset),
    });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   PUT /api/packs — upsert (creatorId+path)
   body: { path, isPublic, description?, coverAssetId? }
───────────────────────────────────────── */
router.put('/', requireAuth, async (req, res, next) => {
  try {
    const path = normalizePath(req.body?.path);
    if (!path) return res.status(400).json({ error: { message: '유효한 폴더 경로 필요 (루트 불가)' } });

    const isPublic = Boolean(req.body?.isPublic);
    const description = req.body?.description ? String(req.body.description).slice(0, 500) : null;
    const coverAssetId = req.body?.coverAssetId || null;

    // coverAssetId 검증 — 본인 에셋이어야 함
    if (coverAssetId) {
      const cover = await prisma.asset.findUnique({ where: { id: coverAssetId }, select: { creatorId: true } });
      if (!cover || cover.creatorId !== req.user.id) {
        return res.status(400).json({ error: { message: '커버 에셋은 본인 것이어야 합니다.' } });
      }
    }

    // 팩 안에 에셋이 0개면 발행 거부
    if (isPublic) {
      const count = await prisma.asset.count({ where: packAssetsWhere(req.user.id, path, true) });
      if (count === 0) {
        return res.status(400).json({ error: { message: '비어 있는 폴더는 팩으로 공개할 수 없습니다.' } });
      }
    }

    const pack = await prisma.folderPack.upsert({
      where:  { creatorId_path: { creatorId: req.user.id, path } },
      create: { creatorId: req.user.id, path, isPublic, description, coverAssetId },
      update: { isPublic, description, coverAssetId },
    });
    res.json({ pack });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   DELETE /api/packs/:id — 팩 메타 삭제 (에셋은 그대로)
───────────────────────────────────────── */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const pack = await prisma.folderPack.findUnique({ where: { id: req.params.id } });
    if (!pack) return res.status(404).json({ error: { message: '없음' } });
    if (pack.creatorId !== req.user.id) return res.status(403).json({ error: { message: '권한 없음' } });
    await prisma.folderPack.delete({ where: { id: pack.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   POST /api/packs/:id/import — 팩 전체 가져오기
   - 안의 공개 에셋을 모두 clone (R2 복사 + DB row 생성)
   - 폴더 경로는 받는 사람 라이브러리에 동일하게 재현
───────────────────────────────────────── */
router.post('/:id/import', requireAuth, async (req, res, next) => {
  try {
    const pack = await prisma.folderPack.findUnique({
      where: { id: req.params.id },
      include: { /* nothing */ },
    });
    if (!pack) return res.status(404).json({ error: { message: '팩 없음' } });
    if (!pack.isPublic) return res.status(403).json({ error: { message: '비공개 팩' } });
    if (pack.creatorId === req.user.id) {
      return res.status(400).json({ error: { message: '본인 팩은 가져올 수 없습니다.' } });
    }

    // 팩 안의 공개 에셋들
    const sources = await prisma.asset.findMany({
      where:   packAssetsWhere(pack.creatorId, pack.path, false),
      orderBy: { createdAt: 'asc' },
    });
    if (sources.length === 0) {
      return res.status(400).json({ error: { message: '팩이 비어있습니다.' } });
    }

    // 프로필 보장
    await prisma.profile.upsert({
      where:  { id: req.user.id },
      create: { id: req.user.id, username: req.user.nickname || `user_${req.user.id.slice(0, 6)}` },
      update: {},
    });

    const creatorProfile = await prisma.profile.findUnique({
      where: { id: pack.creatorId }, select: { username: true },
    });

    const cloned = [];
    for (const src of sources) {
      try {
        const srcKey = src.modelUrl.replace(`${CDN_BASE}/`, '');
        const ext    = path.extname(srcKey);
        const newId  = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const dstKey = `assets/${req.user.id}/${newId}${ext}`;
        // Pack imports keep references to source files instead of copying R2 objects.

        let thumbDstUrl = src.thumbnailUrl;
        if (src.thumbnailUrl) {
          try {
            const tSrcKey = src.thumbnailUrl.replace(`${CDN_BASE}/`, '');
            const tExt    = path.extname(tSrcKey) || '.png';
            const tDstKey = `assets/${req.user.id}/thumb_${newId}${tExt}`;
            thumbDstUrl = src.thumbnailUrl;
          } catch {}
        }

        const existingRefs = await prisma.asset.findMany({
          where: { creatorId: req.user.id, modelUrl: src.modelUrl },
          take: 20,
        });
        const existingRef = existingRefs.find((a) => a.metadata?.importedFrom?.assetId === src.id);
        if (existingRef) {
          cloned.push(existingRef.id);
          continue;
        }

        const meta = {
          ...(src.metadata || {}),
          importedFrom: {
            assetId: src.id, packId: pack.id, packPath: pack.path,
            creatorName: creatorProfile?.username || null,
          },
          referenceOnly: true,
        };

        const c = await prisma.asset.create({
          data: {
            creatorId:    req.user.id,
            name:         src.name,
            modelUrl:     src.modelUrl,
            thumbnailUrl: thumbDstUrl,
            kind:         src.kind,
            metadata:     meta,
            tags:         src.tags || [],
            folder:       src.folder,    // 같은 폴더 경로 유지
            fileSize:     src.fileSize,
            isPublic:     false,
          },
        });
        cloned.push(c.id);
      } catch (e) {
        // 한 파일 실패해도 나머지 진행
        console.error('[pack import] asset clone failed:', src.id, e.message);
      }
    }

    // 팩 importCount + 각 원본 asset.importCount 도 한꺼번에 (best-effort)
    prisma.folderPack.update({
      where: { id: pack.id },
      data:  { importCount: { increment: 1 } },
    }).catch(() => {});
    if (cloned.length > 0) {
      prisma.asset.updateMany({
        where: { id: { in: sources.map(s => s.id) } },
        data:  { importCount: { increment: 1 } },
      }).catch(() => {});
    }

    // 작가에게 알림
    if (pack.creatorId) {
      require('./notifications').createNotification(pack.creatorId, 'asset_imported', {
        packId: pack.id, packPath: pack.path, count: cloned.length, actorName: req.user.nickname,
      });
    }

    res.json({ ok: true, imported: cloned.length, skipped: sources.length - cloned.length });
  } catch (err) { next(err); }
});

module.exports = router;
