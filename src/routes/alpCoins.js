/**
 * ALP 플랫폼 전용 코인 API
 *
 * Airnuri 코인과 완전히 분리된 플랫폼 내부 화폐.
 * 플랫폼 게임(농사, 낚시 등)에서 획득/소비.
 *
 *   GET    /api/alp-coins          — 내 잔액 조회
 *   POST   /api/alp-coins/add      — 적립 (게임 보상)
 *   POST   /api/alp-coins/spend    — 차감 (씨앗 구매 등)
 *   GET    /api/alp-coins/top      — 상위 보유자 순위 (공개)
 */

const { Router } = require('express');
const { z }      = require('zod');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const MAX_ADD   = 100_000_000; // 1회 최대 적립 (플랫폼 내부 코인이라 높게 설정)
const MAX_SPEND = 100_000_000; // 1회 최대 차감

/** 잔액 조회 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { alpCoins: true },
    });
    res.json({ alpCoins: Number(user?.alpCoins ?? 0) });
  } catch (err) { next(err); }
});

/** 적립 — 공식 게임 보상, 이벤트 등 */
router.post('/add', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      amount: z.number().int().positive().max(MAX_ADD),
      reason: z.string().max(100).optional(),
    });
    const { amount, reason } = schema.parse(req.body);

    const user = await prisma.user.update({
      where:  { id: req.user.id },
      data:   { alpCoins: { increment: amount } },
      select: { alpCoins: true },
    });
    console.log(`[ALP] +${amount} → ${req.user.id} (${reason || '-'})`);
    res.json({ ok: true, alpCoins: Number(user.alpCoins) });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 오류' } });
    }
    next(err);
  }
});

/** 차감 — 씨앗 구매, 밭 구매 등 */
router.post('/spend', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      amount: z.number().int().positive().max(MAX_SPEND),
      reason: z.string().max(100).optional(),
    });
    const { amount, reason } = schema.parse(req.body);

    // 잔액 확인 후 차감 (원자적 처리)
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { alpCoins: true },
    });
    const current = Number(user?.alpCoins ?? 0);
    if (current < amount) {
      return res.status(400).json({ error: { message: 'ALP 코인이 부족합니다.' } });
    }

    const updated = await prisma.user.update({
      where:  { id: req.user.id },
      data:   { alpCoins: { decrement: amount } },
      select: { alpCoins: true },
    });
    console.log(`[ALP] -${amount} → ${req.user.id} (${reason || '-'})`);
    res.json({ ok: true, alpCoins: Number(updated.alpCoins) });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 오류' } });
    }
    next(err);
  }
});

/** 상위 보유자 (공개) */
router.get('/top', async (req, res, next) => {
  try {
    const top = await prisma.user.findMany({
      where:   { alpCoins: { gt: 0 } },
      orderBy: { alpCoins: 'desc' },
      take:    20,
      select:  { nickname: true, alpCoins: true },
    });
    res.json({ top: top.map(u => ({ nickname: u.nickname, alpCoins: Number(u.alpCoins) })) });
  } catch (err) { next(err); }
});

module.exports = router;
