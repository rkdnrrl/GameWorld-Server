/**
 * 자판기 / 상점 — 월드 vendingMachine 컴포넌트가 호출하는 구매 엔드포인트.
 *   GET  /api/shop/balance                       (requireAuth) → { coins }
 *   POST /api/shop/purchase                      (requireAuth) → { coins, granted }
 *     body: { name, icon, price, sourceGame?, kind?, category?, tags? }
 *
 * atomic transaction — Profile.coins 차감 + inventory_items INSERT.
 * inventory_items 는 Prisma 미관리(Supabase raw) 라 $executeRaw 사용.
 *
 * Prisma 트랜잭션 안에서 Profile.coins 를 조건부 차감 (`coins >= price`) 해서
 * 잔액 부족이면 0 row 반영 → 거부. 동시 구매 race 도 막힘.
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.get('/balance', requireAuth, async (req, res, next) => {
  try {
    const profile = await prisma.profile.findUnique({
      where: { id: req.user.id },
      select: { coins: true },
    });
    res.json({ coins: profile?.coins ?? 0 });
  } catch (err) {
    next(err);
  }
});

router.post('/purchase', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const name  = String(body.name ?? '').trim().slice(0, 120);
    const icon  = String(body.icon ?? '').trim().slice(0, 16);
    const price = Math.floor(Number(body.price));
    const sourceGame = String(body.sourceGame ?? 'vending').trim().slice(0, 60) || 'vending';
    const kind     = String(body.kind     ?? 'vending_item').trim().slice(0, 80) || 'vending_item';
    const category = String(body.category ?? 'shop').trim().slice(0, 40)         || 'shop';
    const tags     = Array.isArray(body.tags) ? body.tags.map(s => String(s).slice(0, 40)).filter(Boolean).slice(0, 10) : [];

    if (!name) {
      return res.status(400).json({ error: { code: 'BAD_NAME', message: '상품명이 비어 있습니다.' } });
    }
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
      return res.status(400).json({ error: { code: 'BAD_PRICE', message: '가격이 올바르지 않습니다.' } });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 잔액 ≥ price 조건부 차감 — 부족하면 0 row → null 반환
      const updated = await tx.profile.updateMany({
        where: { id: req.user.id, coins: { gte: price } },
        data: { coins: { decrement: price } },
      });
      if (updated.count === 0) return null;

      // 현재 잔액 조회
      const after = await tx.profile.findUnique({
        where: { id: req.user.id },
        select: { coins: true },
      });

      // inventory_items raw insert (Prisma 미관리)
      const tagsArrayLiteral = '{' + tags.map(t => '"' + String(t).replace(/"/g, '\\"') + '"').join(',') + '}';
      await tx.$executeRawUnsafe(
        `INSERT INTO "inventory_items" ("userId", "sourceGame", "kind", "category", "name", "icon", "tags", "stats", "qty")
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::jsonb, 1)`,
        req.user.id, sourceGame, kind, category, name, icon || null, tagsArrayLiteral, JSON.stringify({ price }),
      );

      return { coins: after?.coins ?? 0 };
    });

    if (!result) {
      return res.status(402).json({ error: { code: 'INSUFFICIENT_COINS', message: '코인이 부족합니다.' } });
    }
    res.json({ coins: result.coins, granted: { name, icon, price, sourceGame, kind, category, tags } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
