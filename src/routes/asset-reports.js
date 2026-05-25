/**
 * 에셋 신고 + 운영자 모더레이션
 *   POST   /api/assets/:id/report           — 유저가 신고 (어셋 라우터에 마운트됨, 이 파일은 마운트 X)
 *   GET    /api/operator/asset-reports      — 운영자 큐 (status filter)
 *   PATCH  /api/operator/asset-reports/:id  — 운영자 결정 (dismiss/hide/delete)
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const r2 = require('../lib/r2');

const router = Router();
const CDN_BASE = 'https://play.airliveplay.com';

/** 자동 hide 임계값 — 이 이상 누적 신고 들어오면 자동으로 isPublic=false */
const AUTO_HIDE_THRESHOLD = parseInt(process.env.ASSET_AUTO_HIDE_THRESHOLD || '5', 10);

const REASONS = new Set(['inappropriate', 'copyright', 'spam', 'malware', 'other']);

/* ─────────────────────────────────────────
   POST /report — 유저가 신고 제출 (assets.js 에 마운트)
───────────────────────────────────────── */
async function submitReport(req, res, next) {
  try {
    const id = req.params.id;
    const { reason, comment } = req.body || {};
    if (!REASONS.has(reason)) {
      return res.status(400).json({ error: { message: '잘못된 사유' } });
    }
    const asset = await prisma.asset.findUnique({
      where: { id }, select: { id: true, creatorId: true, isPublic: true },
    });
    if (!asset) return res.status(404).json({ error: { message: '에셋 없음' } });
    if (!asset.isPublic) return res.status(403).json({ error: { message: '공개 에셋만 신고 가능' } });
    if (asset.creatorId === req.user.id) {
      return res.status(400).json({ error: { message: '본인 에셋은 신고 불가' } });
    }

    // 중복 신고 차단 (unique key 도 있지만 친절한 에러 위해 먼저 체크)
    const existing = await prisma.assetReport.findUnique({
      where: { reporterId_assetId: { reporterId: req.user.id, assetId: id } },
    });
    if (existing) {
      return res.status(409).json({ error: { message: '이미 신고하셨습니다.' } });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.assetReport.create({
        data: {
          assetId:    id,
          reporterId: req.user.id,
          reason,
          comment:    comment ? String(comment).slice(0, 500) : null,
        },
      });
      const updated = await tx.asset.update({
        where: { id },
        data:  { reportCount: { increment: 1 } },
        select: { reportCount: true, isPublic: true },
      });

      // 자동 hide
      let autoHidden = false;
      if (updated.isPublic && updated.reportCount >= AUTO_HIDE_THRESHOLD) {
        await tx.asset.update({ where: { id }, data: { isPublic: false } });
        autoHidden = true;
      }
      return { reportCount: updated.reportCount, autoHidden };
    });

    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
}

/* ─────────────────────────────────────────
   GET /api/operator/asset-reports?status=pending&page=1
───────────────────────────────────────── */
router.get('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending');
    const page   = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
    const pageSize = 50;

    const where = ['pending', 'dismissed', 'resolved'].includes(status)
      ? { status }
      : {};

    const [total, reports] = await Promise.all([
      prisma.assetReport.count({ where }),
      prisma.assetReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          asset: {
            select: {
              id: true, name: true, kind: true, modelUrl: true, thumbnailUrl: true,
              isPublic: true, reportCount: true, creatorId: true,
              creator: { select: { username: true } },
            },
          },
        },
      }),
    ]);

    res.json({ reports, page, pageSize, total, hasMore: page * pageSize < total });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   PATCH /api/operator/asset-reports/:id
   body: { resolution: 'dismiss'|'hide'|'delete' }
───────────────────────────────────────── */
router.patch('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const id = req.params.id;
    const resolution = String(req.body?.resolution || '');
    if (!['dismiss', 'hide', 'delete'].includes(resolution)) {
      return res.status(400).json({ error: { message: 'resolution 잘못됨' } });
    }

    const report = await prisma.assetReport.findUnique({ where: { id } });
    if (!report) return res.status(404).json({ error: { message: '신고 없음' } });
    if (report.status !== 'pending') {
      return res.status(409).json({ error: { message: '이미 처리됨' } });
    }

    if (resolution === 'dismiss') {
      // 신고 기각 — 에셋은 그대로
      await prisma.assetReport.update({
        where: { id },
        data:  { status: 'dismissed', resolution: 'dismiss', resolvedBy: req.user.id, resolvedAt: new Date() },
      });
    } else if (resolution === 'hide') {
      // 비공개 처리 — 에셋은 보존, 다른 신고도 같이 resolved 처리
      await prisma.$transaction([
        prisma.asset.update({ where: { id: report.assetId }, data: { isPublic: false } }),
        prisma.assetReport.updateMany({
          where: { assetId: report.assetId, status: 'pending' },
          data:  { status: 'resolved', resolution: 'hide', resolvedBy: req.user.id, resolvedAt: new Date() },
        }),
      ]);
    } else if (resolution === 'delete') {
      // 영구 삭제 (R2 + DB cascade)
      const asset = await prisma.asset.findUnique({ where: { id: report.assetId } });
      if (asset) {
        try {
          const keys = [];
          if (asset.modelUrl)     keys.push(asset.modelUrl.replace(`${CDN_BASE}/`, ''));
          if (asset.thumbnailUrl) keys.push(asset.thumbnailUrl.replace(`${CDN_BASE}/`, ''));
          if (keys.length) await r2.deleteKeys(keys);
        } catch {}
        // assetReport.assetId 가 cascade 라서 같이 삭제됨 — resolved 마킹 의미 없음
        await prisma.asset.delete({ where: { id: asset.id } });
      } else {
        await prisma.assetReport.update({
          where: { id },
          data:  { status: 'resolved', resolution: 'delete', resolvedBy: req.user.id, resolvedAt: new Date() },
        });
      }
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.submitReport = submitReport;
