'use strict';

/**
 * 내부 webhook 라우트 — 다른 서비스(Common API 등)가 호출.
 * 모든 엔드포인트는 `X-Internal-Secret` 헤더로 인증된다.
 */

const { Router } = require('express');
const { prisma } = require('../db');
const { requireInternalSecret } = require('../middleware/internalAuth');

const router = Router();

/**
 * POST /api/internal/users/delete
 *   body: { userId: string }
 *   응답:
 *     200 { ok: true, deleted: userId }   — 삭제 성공
 *     404 { ok: true, deleted: null }     — 이미 없음 (멱등)
 *     400 { error }                       — body 형식 잘못
 *
 * Common API 가 airnuri 탈퇴 직후 호출한다. 응답 body 는 status code 만 본다고
 * 명시되어 있어 형식은 자유. fire-and-forget 이라 실패해도 사용자 경험 영향 없음.
 */
router.post('/users/delete', requireInternalSecret, async (req, res, next) => {
  try {
    const userId = req.body && typeof req.body.userId === 'string' ? req.body.userId.trim() : '';
    if (!userId) {
      return res.status(400).json({ error: { message: 'userId required' } });
    }

    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) {
      return res.status(404).json({ ok: true, deleted: null });
    }

    // Prisma schema 의 onDelete 설정에 따라 관련 테이블 cascade/setNull 자동 처리.
    await prisma.user.delete({ where: { id: userId } });
    console.log(`[internal] platform user deleted via webhook: ${userId}`);
    res.json({ ok: true, deleted: userId });
  } catch (err) {
    console.error('[internal] user delete failed:', err.message);
    next(err);
  }
});

module.exports = router;
