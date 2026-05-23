/**
 * 수산시장 API — 기존 inventory_items 테이블만 활용 (새 테이블 없음)
 *
 * 마켓 진열품 = category:'seafood_listing' 인 inventory_items 행
 * stats 구조: { price, channel, slot, stallName, rarity, caughtAt, originalKind }
 *
 * GET  /api/seafood-market/listings?channel=1  — 채널 전체 진열품 조회
 * POST /api/seafood-market/listings            — 진열 (클라이언트가 먼저 consumeItem)
 * DELETE /api/seafood-market/listings/:id      — 진열 취소 (아이템 복원)
 * POST /api/seafood-market/listings/:id/buy   — 구매 (ALP 이전 + 아이템 지급)
 * POST /api/seafood-market/quick-sell          — 즉시판매 (신선도 반영)
 */

const { Router } = require('express');
const { z }      = require('zod');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const CHANNELS    = [1, 2, 3, 4, 5];
const OPEN_COST   = 500;   // 가게 이름 등록 비용 (ALP)
const MAX_SLOTS   = 6;

// 수수료율
function commRate(price) {
  if (price < 200)  return 0.05;
  if (price < 1000) return 0.10;
  if (price < 5000) return 0.15;
  return 0.20;
}

// 신선도 계수
function freshFactor(caughtAt) {
  if (!caughtAt) return 0.5;
  const hrs = (Date.now() - new Date(caughtAt).getTime()) / 3_600_000;
  if (hrs < 1)   return 1.0;
  if (hrs < 6)   return 0.80;
  if (hrs < 24)  return 0.65;
  if (hrs < 72)  return 0.45;
  if (hrs < 168) return 0.25;
  return 0.10;
}

const BASE_PRICE = { n:50, g:150, r:500, e:1500, l:5000, m:15000, d:50000 };

async function spendAlp(userId, amount) {
  const u = await prisma.user.findUnique({ where:{ id:userId }, select:{ alpCoins:true } });
  if (Number(u?.alpCoins ?? 0) < amount) return false;
  await prisma.user.update({ where:{ id:userId }, data:{ alpCoins:{ decrement:amount } } });
  return true;
}
async function earnAlp(userId, amount) {
  await prisma.user.update({ where:{ id:userId }, data:{ alpCoins:{ increment:amount } } });
}

// ─── 채널 진열품 조회 ─────────────────────────────────────────────────────────
router.get('/listings', async (req, res, next) => {
  try {
    const channel = parseInt(req.query.channel) || 1;
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error:{ message:'잘못된 채널' } });

    // inventory_items 에서 seafood_listing 범주 전체 조회 (모든 유저)
    const rows = await prisma.inventoryItem.findMany({
      where:   { category:'seafood_listing', qty:{ gt:0 } },
      include: { user:{ select:{ nickname:true } } },
      orderBy: { createdAt:'asc' },
    });

    // JS에서 채널 필터링
    const listings = rows
      .filter(r => r.stats?.channel === channel)
      .map(r => ({
        id:         String(r.id),
        sellerId:   r.userId,
        sellerNick: r.user.nickname,
        icon:       r.icon,
        name:       r.name,
        kind:       r.kind,
        stats:      r.stats,
        createdAt:  r.createdAt,
      }));

    // 판매자별로 그룹핑 → stalls
    const stallMap = {};
    for (const l of listings) {
      if (!stallMap[l.sellerId]) {
        stallMap[l.sellerId] = {
          sellerId:   l.sellerId,
          sellerNick: l.sellerNick,
          stallName:  l.stats?.stallName || l.sellerNick,
          listings:   [],
        };
      }
      stallMap[l.sellerId].listings.push(l);
    }

    res.json({ stalls: Object.values(stallMap), listings });
  } catch (err) { next(err); }
});

// ─── 진열 등록 ────────────────────────────────────────────────────────────────
router.post('/listings', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      channel:      z.number().int().min(1).max(5),
      slot:         z.number().int().min(0).max(MAX_SLOTS - 1),
      stallName:    z.string().min(1).max(30),
      price:        z.number().int().positive(),
      itemKind:     z.string().min(1).max(80),
      itemIcon:     z.string().max(16),
      itemName:     z.string().min(1).max(120),
      rarity:       z.string().max(20).optional(),
      caughtAt:     z.string().optional(),
      originalStats:z.record(z.unknown()).optional(),
    });
    const d = schema.parse(req.body);

    // 같은 슬롯에 이미 진열 중인지 확인
    const existing = await prisma.inventoryItem.findMany({
      where: { userId:req.user.id, category:'seafood_listing', qty:{ gt:0 } },
    });
    const slotTaken = existing.find(r => r.stats?.channel === d.channel && r.stats?.slot === d.slot);
    if (slotTaken) return res.status(409).json({ error:{ message:'해당 슬롯은 이미 사용 중입니다.' } });
    if (existing.filter(r=>r.stats?.channel===d.channel).length >= MAX_SLOTS) {
      return res.status(400).json({ error:{ message:`최대 ${MAX_SLOTS}개까지 진열 가능합니다.` } });
    }

    // inventory_items 에 seafood_listing 항목 생성
    const item = await prisma.inventoryItem.create({
      data: {
        userId:    req.user.id,
        sourceGame:'seafood-market',
        kind:      d.itemKind,
        category:  'seafood_listing',
        name:      d.itemName,
        icon:      d.itemIcon,
        qty:       1,
        stats: {
          price:         d.price,
          channel:       d.channel,
          slot:          d.slot,
          stallName:     d.stallName,
          rarity:        d.rarity,
          caughtAt:      d.caughtAt,
          originalKind:  d.itemKind,
          originalStats: d.originalStats || {},
        },
      },
    });
    res.status(201).json({ listing: { ...item, id: String(item.id) } });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error:{ message:err.issues?.[0]?.message } });
    next(err);
  }
});

// ─── 진열 취소 (아이템 복원) ─────────────────────────────────────────────────
router.delete('/listings/:id', requireAuth, async (req, res, next) => {
  try {
    const id = BigInt(req.params.id);
    const item = await prisma.inventoryItem.findUnique({ where:{ id } });
    if (!item) return res.status(404).json({ error:{ message:'없는 항목' } });
    if (item.userId !== req.user.id) return res.status(403).json({ error:{ message:'권한 없음' } });
    if (item.category !== 'seafood_listing') return res.status(400).json({ error:{ message:'진열 아이템이 아닙니다.' } });

    const s = item.stats || {};
    await prisma.inventoryItem.delete({ where:{ id } });

    // 원래 물고기 아이템 복원
    await prisma.inventoryItem.create({
      data: {
        userId:    req.user.id,
        sourceGame:'fishing',
        kind:      s.originalKind || item.kind,
        category:  'seafood',
        name:      item.name,
        icon:      item.icon,
        qty:       1,
        stats:     { ...(s.originalStats || {}), rarity:s.rarity, caughtAt:s.caughtAt, restoredFrom:'market' },
      },
    });
    res.json({ ok:true });
  } catch (err) { next(err); }
});

// ─── 구매 ──────────────────────────────────────────────────────────────────────
router.post('/listings/:id/buy', requireAuth, async (req, res, next) => {
  try {
    const id = BigInt(req.params.id);
    const listing = await prisma.inventoryItem.findUnique({ where:{ id } });
    if (!listing || listing.category !== 'seafood_listing' || listing.qty < 1) {
      return res.status(404).json({ error:{ message:'없거나 이미 판매된 상품입니다.' } });
    }
    if (listing.userId === req.user.id) {
      return res.status(400).json({ error:{ message:'자신의 상품은 구매할 수 없습니다.' } });
    }

    const s     = listing.stats || {};
    const price = s.price || 0;
    const comm  = Math.round(price * commRate(price));
    const earn  = price - comm;

    // 구매자 ALP 차감
    const ok = await spendAlp(req.user.id, price);
    if (!ok) return res.status(400).json({ error:{ message:'ALP 코인이 부족합니다.' } });

    // 판매자 ALP 지급
    await earnAlp(listing.userId, earn);

    // 진열 아이템 삭제
    await prisma.inventoryItem.delete({ where:{ id } });

    // 구매자 인벤토리에 해산물 지급
    await prisma.inventoryItem.create({
      data: {
        userId:    req.user.id,
        sourceGame:'seafood-market',
        kind:      s.originalKind || listing.kind,
        category:  'seafood',
        name:      listing.name,
        icon:      listing.icon,
        qty:       1,
        stats:     { ...(s.originalStats || {}), rarity:s.rarity, caughtAt:s.caughtAt, boughtFrom:s.stallName },
      },
    });

    const buyer = await prisma.user.findUnique({ where:{ id:req.user.id }, select:{ alpCoins:true } });
    res.json({ ok:true, price, commission:comm, sellerEarned:earn, alpCoins: Number(buyer?.alpCoins ?? 0) });
  } catch (err) { next(err); }
});

// ─── 진열대 임대 현황 ─────────────────────────────────────────────────────────
router.get('/rentals', async (req, res, next) => {
  try {
    const channel = parseInt(req.query.channel) || 1;
    const rows = await prisma.inventoryItem.findMany({
      where:   { category:'stall_rental', qty:{ gt:0 } },
      include: { user:{ select:{ nickname:true } } },
    });
    const rentals = rows
      .filter(r => r.stats?.channel === channel)
      .map(r => ({
        stallId:  r.stats?.stallId,
        userId:   r.userId,
        nickname: r.user.nickname,
        stallName:r.stats?.stallName || r.user.nickname,
        itemId:   String(r.id),
      }));
    res.json({ rentals });
  } catch (err) { next(err); }
});

// ─── 진열대 임대 ──────────────────────────────────────────────────────────────
router.post('/rent-stall', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      stallId:   z.string().min(1).max(10),
      channel:   z.number().int().min(1).max(5),
      stallName: z.string().min(1).max(30),
      rentFee:   z.number().int().positive(),
    });
    const d = schema.parse(req.body);

    // 이미 임대 중인지 확인
    const existing = await prisma.inventoryItem.findFirst({
      where: { category:'stall_rental', qty:{ gt:0 },
               stats:{ path:['stallId'], equals:d.stallId } },
    });
    if (existing) return res.status(409).json({ error:{ message:'이미 임대 중인 자리입니다.' } });

    // 내가 이 채널에서 이미 다른 자리를 임대 중인지 (1인 1자리)
    const myRental = await prisma.inventoryItem.findFirst({
      where: { userId:req.user.id, category:'stall_rental', qty:{ gt:0 } },
    });
    if (myRental && myRental.stats?.channel === d.channel) {
      return res.status(409).json({ error:{ message:'이미 이 채널에 자리가 있습니다.' } });
    }

    const ok = await spendAlp(req.user.id, d.rentFee);
    if (!ok) return res.status(400).json({ error:{ message:`ALP 코인 ${d.rentFee}개가 필요합니다.` } });

    await prisma.inventoryItem.create({
      data:{
        userId:    req.user.id,
        sourceGame:'seafood-market',
        kind:      'stall_rental',
        category:  'stall_rental',
        name:      `자리 ${d.stallId}`,
        icon:      '🏪',
        qty:       1,
        stats:     { stallId:d.stallId, channel:d.channel, stallName:d.stallName, rentedAt:new Date().toISOString() },
      },
    });

    const u = await prisma.user.findUnique({ where:{ id:req.user.id }, select:{ alpCoins:true } });
    res.json({ ok:true, alpCoins: Number(u?.alpCoins ?? 0) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error:{ message:err.issues?.[0]?.message } });
    next(err);
  }
});

// ─── 자리 반납 ────────────────────────────────────────────────────────────────
router.post('/leave-stall', requireAuth, async (req, res, next) => {
  try {
    const { channel } = z.object({ channel:z.number().int().min(1).max(5) }).parse(req.body);
    const rental = await prisma.inventoryItem.findFirst({
      where:{ userId:req.user.id, category:'stall_rental', qty:{ gt:0 } },
    });
    if (!rental || rental.stats?.channel !== channel)
      return res.status(404).json({ error:{ message:'임대 중인 자리가 없습니다.' } });

    // 해당 자리의 진열 아이템도 모두 회수
    const listings = await prisma.inventoryItem.findMany({
      where:{ userId:req.user.id, category:'seafood_listing', qty:{ gt:0 } },
    });
    const myListings = listings.filter(l => l.stats?.channel===channel && l.stats?.stallId===rental.stats?.stallId);
    for (const l of myListings) {
      await prisma.inventoryItem.delete({ where:{ id:l.id } });
      await prisma.inventoryItem.create({
        data:{ userId:req.user.id, sourceGame:'fishing', kind:l.stats?.originalKind||l.kind,
               category:'seafood', name:l.name, icon:l.icon, qty:1,
               stats:{ ...(l.stats?.originalStats||{}), rarity:l.stats?.rarity, restoredFrom:'market' } },
      });
    }
    await prisma.inventoryItem.delete({ where:{ id:rental.id } });
    res.json({ ok:true });
  } catch (err) { next(err); }
});

// ─── 즉시판매 ─────────────────────────────────────────────────────────────────
router.post('/quick-sell', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      rarity:   z.string().max(20).optional(),
      caughtAt: z.string().optional(),
      itemName: z.string().optional(),
    });
    const { rarity, caughtAt } = schema.parse(req.body);

    const base   = BASE_PRICE[rarity ?? 'n'] ?? 50;
    const fresh  = freshFactor(caughtAt);
    const earned = Math.max(1, Math.round(base * fresh));

    await earnAlp(req.user.id, earned);
    const u = await prisma.user.findUnique({ where:{ id:req.user.id }, select:{ alpCoins:true } });
    res.json({ ok:true, earned, freshPct: Math.round(fresh * 100), alpCoins: Number(u?.alpCoins ?? 0) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error:{ message:err.issues?.[0]?.message } });
    next(err);
  }
});

module.exports = router;
