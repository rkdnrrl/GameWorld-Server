/**
 * 에셋 타입(asset_kinds) 라우트
 *   GET    /api/asset-kinds         — 활성 타입 목록 (공개)
 *   GET    /api/asset-kinds/all     — 비활성 포함 전체 (운영자)
 *   POST   /api/asset-kinds         — 추가 (운영자)
 *   PATCH  /api/asset-kinds/:id     — 수정 (운영자)
 *   DELETE /api/asset-kinds/:id     — 삭제 (운영자, 사용 중이면 거부)
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const assetsRoute = require('./assets');

const router = Router();

/** 운영자도 못 추가하는 위험 확장자 (서버 강제 블랙리스트) */
const DANGEROUS_EXTS = new Set([
  'exe','bat','cmd','sh','ps1','msi','dll','so','dylib',
  'jar','app','deb','rpm','scr','vbs','com','pif',
  'html','htm','svg',
]);

/* GET /api/asset-kinds — 공개 (활성만) */
router.get('/', async (_req, res, next) => {
  try {
    const kinds = await prisma.assetKind.findMany({
      where:   { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json({ kinds });
  } catch (err) { next(err); }
});

/* GET /api/asset-kinds/all — 운영자 (비활성 포함) */
router.get('/all', requireAuth, requireOperator, async (_req, res, next) => {
  try {
    const kinds = await prisma.assetKind.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json({ kinds });
  } catch (err) { next(err); }
});

/** 입력 검증·정제 */
function sanitizeKindInput(body, { isCreate }) {
  const errors = [];
  const out = {};

  if (isCreate) {
    const id = String(body.id || '').toLowerCase().trim();
    if (!/^[a-z][a-z0-9_-]{1,30}$/.test(id)) {
      errors.push('id 는 소문자로 시작하는 2~31자 (a-z/0-9/_/-).');
    }
    out.id = id;
  }

  if (body.label !== undefined) {
    const label = String(body.label).trim();
    if (label.length < 1 || label.length > 50) errors.push('label 1~50자');
    out.label = label;
  } else if (isCreate) {
    errors.push('label 필수');
  }

  if (body.icon !== undefined) out.icon = body.icon ? String(body.icon).slice(0, 8) : null;

  if (body.extensions !== undefined) {
    if (!Array.isArray(body.extensions)) {
      errors.push('extensions 는 배열');
    } else {
      const exts = body.extensions
        .map(e => String(e).toLowerCase().replace(/^\./, '').trim())
        .filter(Boolean);
      if (exts.length === 0) errors.push('extensions 최소 1개');
      const bad = exts.filter(e => DANGEROUS_EXTS.has(e));
      if (bad.length) errors.push(`위험 확장자 차단: ${bad.join(', ')}`);
      out.extensions = Array.from(new Set(exts));
    }
  } else if (isCreate) {
    errors.push('extensions 필수');
  }

  if (body.mimeTypes !== undefined) {
    out.mimeTypes = Array.isArray(body.mimeTypes)
      ? body.mimeTypes.map(m => String(m).toLowerCase().slice(0, 100)).filter(Boolean)
      : [];
  }

  if (body.maxSizeMb !== undefined) {
    const n = Number(body.maxSizeMb);
    if (!Number.isFinite(n) || n < 1 || n > 500) errors.push('maxSizeMb 1~500');
    else out.maxSizeMb = Math.floor(n);
  }

  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) errors.push('sortOrder 숫자');
    else out.sortOrder = Math.floor(n);
  }

  if (body.enabled !== undefined) out.enabled = Boolean(body.enabled);

  return { data: out, errors };
}

/* POST /api/asset-kinds — 추가 (운영자) */
router.post('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { data, errors } = sanitizeKindInput(req.body || {}, { isCreate: true });
    if (errors.length) return res.status(400).json({ error: { message: errors.join(' / ') } });

    // 중복 ID 체크
    const exists = await prisma.assetKind.findUnique({ where: { id: data.id } });
    if (exists) return res.status(409).json({ error: { message: `id "${data.id}" 이미 존재` } });

    // 확장자 충돌 체크 (다른 활성 kind 와 겹치면 매칭 모호)
    const all = await prisma.assetKind.findMany({ where: { enabled: true } });
    const conflict = all.find(k => k.extensions.some(e => data.extensions.includes(e)));
    if (conflict) {
      return res.status(409).json({
        error: { message: `확장자 충돌: "${conflict.id}" 와 겹침 (${conflict.extensions.filter(e => data.extensions.includes(e)).join(', ')})` },
      });
    }

    const created = await prisma.assetKind.create({ data });
    assetsRoute.invalidateKindsCache?.();
    res.json({ kind: created });
  } catch (err) { next(err); }
});

/* PATCH /api/asset-kinds/:id — 수정 (운영자) */
router.patch('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const id = req.params.id;
    const existing = await prisma.assetKind.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: { message: '없음' } });

    const { data, errors } = sanitizeKindInput(req.body || {}, { isCreate: false });
    if (errors.length) return res.status(400).json({ error: { message: errors.join(' / ') } });

    // 확장자 변경 시 다른 활성 kind 와 충돌 검사
    if (data.extensions) {
      const others = await prisma.assetKind.findMany({
        where: { enabled: true, NOT: { id } },
      });
      const conflict = others.find(k => k.extensions.some(e => data.extensions.includes(e)));
      if (conflict) {
        return res.status(409).json({
          error: { message: `확장자 충돌: "${conflict.id}" 와 겹침` },
        });
      }
    }

    const updated = await prisma.assetKind.update({ where: { id }, data });
    assetsRoute.invalidateKindsCache?.();
    res.json({ kind: updated });
  } catch (err) { next(err); }
});

/* DELETE /api/asset-kinds/:id — 삭제 (운영자)
   사용 중인 에셋이 있으면 거부 (대신 enabled=false 권장) */
router.delete('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const id = req.params.id;
    const inUse = await prisma.asset.count({ where: { kind: id } });
    if (inUse > 0) {
      return res.status(409).json({
        error: { message: `사용 중 (${inUse}개 에셋). 삭제 대신 비활성화하세요.` },
      });
    }
    await prisma.assetKind.delete({ where: { id } });
    assetsRoute.invalidateKindsCache?.();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
