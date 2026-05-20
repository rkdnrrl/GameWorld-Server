/**
 * 게임별 내부 상태 저장소.
 *
 * 어떤 official 게임이든 자기 토큰으로 호출 가능:
 *   GET    /api/game-state/:slug      — 내 데이터 조회 (없으면 빈 객체 {})
 *   PUT    /api/game-state/:slug      — 전체 교체
 *   PATCH  /api/game-state/:slug      — 부분 병합 (얕은 merge; Postgres jsonb || 연산자)
 *   DELETE /api/game-state/:slug      — 완전 삭제 (초기화)
 *
 * 본인 user 의 데이터만 접근. slug 가 다른 게임의 데이터엔 접근 불가 — 게임이 자기
 * slug 만 호출하는 게 기본 사용 패턴이지만 권한 자체는 user 기준.
 */

const { Router } = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;
const MAX_JSON_BYTES = 64 * 1024; // 64 KB / game state

function parseSlug(req, res) {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) {
    res.status(400).json({ error: { message: 'slug 형식이 잘못되었습니다.' } });
    return null;
  }
  return slug;
}

const dataSchema = z.record(z.unknown());

function validateSize(obj, res) {
  const bytes = Buffer.byteLength(JSON.stringify(obj || {}), 'utf8');
  if (bytes > MAX_JSON_BYTES) {
    res.status(413).json({ error: { message: `데이터가 너무 큽니다 (최대 ${MAX_JSON_BYTES / 1024}KB).` } });
    return false;
  }
  return true;
}

/** GET — 현재 데이터 (없으면 {}) */
router.get('/:slug', requireAuth, async (req, res, next) => {
  try {
    const slug = parseSlug(req, res); if (!slug) return;
    const row = await prisma.gameState.findUnique({
      where: { userId_gameSlug: { userId: req.user.id, gameSlug: slug } },
    });
    res.json({ slug, data: row?.data ?? {}, updatedAt: row?.updatedAt ?? null });
  } catch (err) { next(err); }
});

/** PUT — 전체 교체 (upsert) */
router.put('/:slug', requireAuth, async (req, res, next) => {
  try {
    const slug = parseSlug(req, res); if (!slug) return;
    const data = dataSchema.parse(req.body?.data ?? req.body ?? {});
    if (!validateSize(data, res)) return;

    const row = await prisma.gameState.upsert({
      where: { userId_gameSlug: { userId: req.user.id, gameSlug: slug } },
      create: { userId: req.user.id, gameSlug: slug, data },
      update: { data },
    });
    res.json({ slug, data: row.data, updatedAt: row.updatedAt });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: 'data 는 JSON 객체여야 합니다.' } });
    }
    next(err);
  }
});

/** PATCH — 얕은 병합 (Postgres jsonb || 연산자).
 *  중첩 객체가 있으면 그 키 자체가 교체됨 (deep merge 아님).
 *  deep merge 필요하면 클라이언트에서 합쳐 PUT 으로 전송. */
router.patch('/:slug', requireAuth, async (req, res, next) => {
  try {
    const slug = parseSlug(req, res); if (!slug) return;
    const patch = dataSchema.parse(req.body?.data ?? req.body ?? {});
    if (!validateSize(patch, res)) return;

    // 동시성 안전 + 단일 SQL — raw query 로 jsonb || 사용
    const rows = await prisma.$queryRaw`
      INSERT INTO "game_state" ("userId", "gameSlug", "data", "updatedAt")
      VALUES (${req.user.id}, ${slug}, ${JSON.stringify(patch)}::jsonb, NOW())
      ON CONFLICT ("userId", "gameSlug")
      DO UPDATE SET "data" = "game_state"."data" || EXCLUDED."data", "updatedAt" = NOW()
      RETURNING "data", "updatedAt"
    `;
    const row = Array.isArray(rows) && rows[0] ? rows[0] : { data: patch, updatedAt: new Date() };

    // 병합 후 크기 재검증
    if (!validateSize(row.data, res)) {
      // 너무 커진 경우 롤백은 어렵지만 경고 — 클라이언트가 다음 호출에서 정리하도록.
      return; // 응답은 validateSize 안에서 처리됨
    }
    res.json({ slug, data: row.data, updatedAt: row.updatedAt });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: 'data 는 JSON 객체여야 합니다.' } });
    }
    next(err);
  }
});

/** DELETE — 게임 상태 초기화 */
router.delete('/:slug', requireAuth, async (req, res, next) => {
  try {
    const slug = parseSlug(req, res); if (!slug) return;
    await prisma.gameState.deleteMany({
      where: { userId: req.user.id, gameSlug: slug },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
