'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

// 상점 아이템 카탈로그 (고정)
const SHOP_ITEMS = [
  { id: 'stone_common',  name: '일반 강화석',  emoji: '🪨', price: 100,  kind: 'enhancement', desc: '장비 강화에 사용하는 기본 재료' },
  { id: 'stone_rare',    name: '희귀 강화석',  emoji: '💎', price: 500,  kind: 'enhancement', desc: '희귀 장비 강화에 필요한 재료' },
  { id: 'crystal_magic', name: '마정석',       emoji: '🔮', price: 2000, kind: 'enhancement', desc: '고급 장비 강화에 사용하는 마법 결정' },
  { id: 'shard_legend',  name: '전설 파편',    emoji: '⭐', price: 8000, kind: 'enhancement', desc: '전설 등급 장비 강화에 필요한 희귀 파편' },
];

// 카탈로그 조회 (공개)
router.get('/catalog', (req, res) => {
  res.json({ items: SHOP_ITEMS });
});

// 구매
router.post('/buy', requireAuth, async (req, res, next) => {
  try {
    const { itemId, quantity = 1 } = req.body;
    const qty = Math.max(1, Math.min(99, Math.floor(Number(quantity) || 1)));

    const shopItem = SHOP_ITEMS.find((i) => i.id === itemId);
    if (!shopItem) {
      return res.status(400).json({ error: { message: '존재하지 않는 상품입니다.' } });
    }

    const totalCost = shopItem.price * qty;

    // 코인 확인 & 차감 (atomic)
    let updatedUser;
    try {
      updatedUser = await prisma.user.update({
        where: { id: req.user.id, coins: { gte: totalCost } },
        data:  { coins: { decrement: totalCost } },
        select: { coins: true },
      });
    } catch {
      // where 조건 불일치 → 코인 부족
      return res.status(400).json({ error: { message: '코인이 부족합니다.' } });
    }

    // 강화 재고에 추가
    if (shopItem.kind === 'enhancement') {
      await prisma.enhancementStock.upsert({
        where:  { userId_itemType: { userId: req.user.id, itemType: shopItem.id } },
        create: { userId: req.user.id, itemType: shopItem.id, count: qty },
        update: { count: { increment: qty } },
      });
    }

    res.json({
      ok: true,
      itemId: shopItem.id,
      itemName: shopItem.name,
      quantity: qty,
      spent: totalCost,
      remainingCoins: updatedUser.coins,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
