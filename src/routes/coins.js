const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { earnCoins, spendCoins } = require('../lib/commonApi');

const router = Router();

// 현재 코인 조회 — Common API에서 가져옴
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const COMMON_API = 'https://api.airliveplay.com';
    const response = await fetch(`${COMMON_API}/api/coins/${req.user.commonUserId || req.user.id}`);
    if (!response.ok) return res.json({ coins: 0 });
    const data = await response.json();
    res.json({ coins: data.coins ?? 0 });
  } catch (err) {
    next(err);
  }
});

// 코인 적립
router.post('/add', requireAuth, async (req, res, next) => {
  try {
    const amount = Math.floor(Number(req.body.amount));
    if (!amount || amount <= 0 || amount > 10000) {
      return res.status(400).json({ error: { message: '올바르지 않은 코인 수량입니다.' } });
    }
    await earnCoins(req.user.commonUserId || req.user.id, amount, req.body.reason || '지급', 'platform');
    // 지급 후 잔액 재조회
    const COMMON_API = 'https://api.airliveplay.com';
    const response = await fetch(`${COMMON_API}/api/coins/${req.user.commonUserId || req.user.id}`);
    const data = response.ok ? await response.json() : { coins: 0 };
    res.json({ coins: data.coins ?? 0 });
  } catch (err) {
    next(err);
  }
});

// 코인 차감
router.post('/spend', requireAuth, async (req, res, next) => {
  try {
    const amount = Math.floor(Number(req.body.amount));
    if (!amount || amount <= 0 || amount > 10000) {
      return res.status(400).json({ error: { message: '올바르지 않은 코인 수량입니다.' } });
    }
    const ok = await spendCoins(req.user.commonUserId || req.user.id, amount, req.body.reason || '사용', 'platform');
    if (!ok) return res.status(400).json({ error: { message: '코인이 부족합니다.' } });
    const COMMON_API = 'https://api.airliveplay.com';
    const response = await fetch(`${COMMON_API}/api/coins/${req.user.commonUserId || req.user.id}`);
    const data = response.ok ? await response.json() : { coins: 0 };
    res.json({ ok: true, coins: data.coins ?? 0 });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
