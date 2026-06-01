/**
 * 운영자 관리 — 다른 운영자만 호출 가능.
 *
 * 라우트:
 *   GET    /api/operators           → 현재 운영자 목록
 *   POST   /api/operators/promote   → body: { username } → 그 사용자를 운영자로
 *   DELETE /api/operators/:userId   → 운영자 권한 해제 (자기 자신 해제 금지)
 *
 * 사용 흐름: 새 운영자가 될 사람은 먼저 웹에서 회원가입 → 운영자가 데스크톱 콘솔에서
 *           username 입력해 승격.
 */
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();

// 목록
router.get('/', requireAuth, requireOperator, async (_req, res, next) => {
  try {
    const operators = await prisma.profile.findMany({
      where: { isOperator: true },
      select: { id: true, username: true, createdAt: true, profileImageUrl: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ operators });
  } catch (err) { next(err); }
});

// 승격 — username 으로 찾아 isOperator = true
router.post('/promote', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) return res.status(400).json({ error: { message: 'username 이 필요합니다.' } });
    if (username.length > 30) return res.status(400).json({ error: { message: 'username 이 너무 깁니다.' } });

    const target = await prisma.profile.findUnique({ where: { username } });
    if (!target) return res.status(404).json({ error: { message: `사용자를 찾을 수 없습니다: ${username}` } });
    if (target.isOperator) return res.status(409).json({ error: { message: `${username} 은 이미 운영자입니다.` } });

    const updated = await prisma.profile.update({
      where: { id: target.id },
      data: { isOperator: true },
      select: { id: true, username: true, createdAt: true, profileImageUrl: true },
    });
    res.json({ operator: updated });
  } catch (err) { next(err); }
});

// 해제 — 자기 자신은 해제 불가 (lockout 방지)
router.delete('/:userId', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const userId = req.params.userId;
    if (userId === req.user.id) {
      return res.status(403).json({ error: { message: '자기 자신의 운영자 권한은 해제할 수 없습니다.' } });
    }
    const target = await prisma.profile.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: { message: '사용자를 찾을 수 없습니다.' } });
    if (!target.isOperator) return res.status(409).json({ error: { message: '이미 운영자가 아닙니다.' } });
    await prisma.profile.update({ where: { id: userId }, data: { isOperator: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
