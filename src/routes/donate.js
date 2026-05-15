'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || '';
const COINS_PER_WON = 1; // 1원 = 1코인
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 10_000_000;

/**
 * POST /api/donate/confirm
 * 토스페이먼츠 결제 확인 후 코인 지급
 * body: { paymentKey: string, orderId: string, amount: number }
 */
router.post('/confirm', requireAuth, async (req, res, next) => {
  try {
    if (!TOSS_SECRET_KEY) {
      return res.status(503).json({ error: { message: '결제 서비스가 설정되지 않았습니다.' } });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const paymentKey = typeof body.paymentKey === 'string' ? body.paymentKey.trim() : '';
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const amount = Number(body.amount);

    if (!paymentKey || !orderId) {
      return res.status(400).json({ error: { message: 'paymentKey와 orderId가 필요합니다.' } });
    }
    if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      return res.status(400).json({ error: { message: `금액은 ${MIN_AMOUNT.toLocaleString()}원 이상이어야 합니다.` } });
    }

    // 중복 처리 방지
    const existing = await prisma.donation.findUnique({ where: { orderId } });
    if (existing) {
      return res.json({ ok: true, coins: existing.coins, amount: existing.amount, alreadyProcessed: true });
    }

    // 토스페이먼츠 결제 확인 요청
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(TOSS_SECRET_KEY + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    const tossData = await tossRes.json();
    if (!tossRes.ok) {
      return res.status(400).json({
        error: { message: tossData.message || `결제 확인 실패 (${tossData.code || tossRes.status})` },
      });
    }

    const coins = Math.floor(amount * COINS_PER_WON);

    // DB 저장 + 코인 지급 (원자적으로)
    await prisma.$transaction([
      prisma.donation.create({
        data: {
          userId: req.user.id,
          orderId,
          paymentKey: tossData.paymentKey,
          amount,
          coins,
          status: 'done',
        },
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { coins: { increment: coins } },
      }),
    ]);

    res.json({ ok: true, coins, amount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
