/**
 * 수산시장 API
 *
 * GET  /api/seafood-market/stalls?channel=1        — 채널 전체 가게+진열 조회
 * POST /api/seafood-market/stall                   — 가게 열기/수정 (500 ALP)
 * GET  /api/seafood-market/stall/mine?channel=1    — 내 가게 조회
 * POST /api/seafood-market/listings                — 아이템 진열 (클라이언트가 consume 먼저)
 * DELETE /api/seafood-market/listings/:id          — 진열 취소 (아이템 반환)
 * POST /api/seafood-market/listings/:id/buy        — 구매 (ALP 코인 이전 + 아이템 지급)
 * POST /api/seafood-market/quick-sell              — 즉시판매 (freshness 반영 가격)
 */

const { Router } = require('express');
const { z }      = require('zod');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const STALL_OPEN_COST = 500;   // ALP 코인
const MAX_SLOTS       = 6;     // 가게 진열 최대 슬롯
const CHANNELS        = [1,2,3,4,5];

/** 수수료율 (판매가 기준) */
function commissionRate(price) {
  if (price < 200)   return 0.05;
  if (price < 1000)  return 0.10;
  if (price < 5000)  return 0.15;
  return 0.20;
}

/** ALP 코인 차감 */
async function spendAlp(userId, amount) {
  const user = await prisma.user.findUnique({ where:{ id:userId }, select:{ alpCoins:true } });
  if (!user || Number(user.alpCoins) < amount) return false;
  await prisma.user.update({ where:{ id:userId }, data:{ alpCoins:{ decrement: amount } } });
  return true;
}
/** ALP 코인 적립 */
async function earnAlp(userId, amount) {
  await prisma.user.update({ where:{ id:userId }, data:{ alpCoins:{ increment: amount } } });
}

/** 신선도 계수 (caughtAt → 0~1) */
function freshnessFactor(caughtAt) {
  if (!caughtAt) return 0.5;
  const hrs = (Date.now() - new Date(caughtAt).getTime()) / 3600000;
  if (hrs < 1)   return 1.0;
  if (hrs < 6)   return 0.8;
  if (hrs < 24)  return 0.65;
  if (hrs < 72)  return 0.45;
  if (hrs < 168) return 0.25;
  return 0.10;
}

/** 즉시판매 기본가 (희귀도 기준) */
const QUICK_BASE = { n:50, g:150, r:500, e:1500, l:5000, m:15000, d:50000 };

// ─── 채널 전체 조회 ────────────────────────────────────────────────────────────
router.get('/stalls', async (req, res, next) => {
  try {
    const channel = parseInt(req.query.channel) || 1;
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error:{ message:'잘못된 채널' } });

    const stalls = await prisma.seafoodMarketStall.findMany({
      where:   { channel },
      include: {
        user:     { select:{ nickname:true } },
        listings: {
          where:  { soldAt:null },
          orderBy:{ slot:'asc' },
        },
      },
      orderBy: { createdAt:'asc' },
    });
    res.json({ stalls });
  } catch (err) { next(err); }
});

// ─── 내 가게 조회 ──────────────────────────────────────────────────────────────
router.get('/stall/mine', requireAuth, async (req, res, next) => {
  try {
    const channel = parseInt(req.query.channel) || 1;
    const stall = await prisma.seafoodMarketStall.findUnique({
      where:   { channel_userId:{ channel, userId:req.user.id } },
      include: { listings:{ where:{ soldAt:null }, orderBy:{ slot:'asc' } } },
    });
    res.json({ stall: stall || null });
  } catch (err) { next(err); }
});

// ─── 가게 열기 / 수정 ─────────────────────────────────────────────────────────
router.post('/stall', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      channel: z.number().int().min(1).max(5),
      name:    z.string().min(1).max(30),
      desc:    z.string().max(100).optional(),
    });
    const { channel, name, desc } = schema.parse(req.body);

    const existing = await prisma.seafoodMarketStall.findUnique({
      where: { channel_userId:{ channel, userId:req.user.id } },
    });

    if (existing) {
      // 수정 (무료)
      const stall = await prisma.seafoodMarketStall.update({
        where: { id:existing.id },
        data:  { name, desc },
      });
      return res.json({ stall });
    }

    // 신규 개설 — 500 ALP 차감
    const ok = await spendAlp(req.user.id, STALL_OPEN_COST);
    if (!ok) return res.status(400).json({ error:{ message:`가게를 열려면 ${STALL_OPEN_COST} ALP가 필요합니다.` } });

    const stall = await prisma.seafoodMarketStall.create({
      data: { channel, userId:req.user.id, name, desc },
    });
    const alpUser = await prisma.user.findUnique({ where:{ id:req.user.id }, select:{ alpCoins:true } });
    res.json({ stall, alpCoins: Number(alpUser?.alpCoins ?? 0) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error:{ message:err.issues?.[0]?.message } });
    next(err);
  }
});

// ─── 아이템 진열 ───────────────────────────────────────────────────────────────
router.post('/listings', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      channel:  z.number().int().min(1).max(5),
      slot:     z.number().int().min(0).max(MAX_SLOTS - 1),
      itemKind: z.string().min(1).max(80),
      itemIcon: z.string().max(16),
      itemName: z.string().min(1).max(120),
      rarity:   z.string().max(20).optional(),
      caughtAt: z.string().optional(),
      stats:    z.record(z.unknown()).optional(),
      price:    z.number().int().positive().max(100000000),
    });
    const data = schema.parse(req.body);

    const stall = await prisma.seafoodMarketStall.findUnique({
      where:   { channel_userId:{ channel:data.channel, userId:req.user.id } },
      include: { listings:{ where:{ soldAt:null } } },
    });
    if (!stall) return res.status(404).json({ error:{ message:'가게가 없습니다.' } });

    const slotTaken = stall.listings.find(l => l.slot === data.slot);
    if (slotTaken) return res.status(409).json({ error:{ message:'슬롯이 이미 사용 중입니다.' } });
    if (stall.listings.length >= MAX_SLOTS) return res.status(400).json({ error:{ message:`최대 ${MAX_SLOTS}개까지 진열 가능합니다.` } });

    const listing = await prisma.seafoodMarketListing.create({
      data: {
        stallId:  stall.id,
        sellerId: req.user.id,
        slot:     data.slot,
        itemKind: data.itemKind,
        itemIcon: data.itemIcon,
        itemName: data.itemName,
        rarity:   data.rarity,
        caughtAt: data.caughtAt ? new Date(data.caughtAt) : null,
        stats:    data.stats || {},
        price:    data.price,
      },
    });
    res.status(201).json({ listing });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error:{ message:err.issues?.[0]?.message } });
    next(err);
  }
});

// ─── 진열 취소 (아이템 반환) ───────────────────────────────────────────────────
router.delete('/listings/:id', requireAuth, async (req, res, next) => {
  try {
    const listing = await prisma.seafoodMarketListing.findUnique({ where:{ id:req.params.id } });
    if (!listing) return res.status(404).json({ error:{ message:'없는 진열' } });
    if (listing.sellerId !== req.user.id) return res.status(403).json({ error:{ message:'권한 없음' } });
    if (listing.soldAt) return res.status(400).json({ error:{ message:'이미 판매됨' } });

    await prisma.seafoodMarketListing.delete({ where:{ id:req.params.id } });

    // 아이템 인벤토리 반환
    await prisma.inventoryItem.create({
      data: {
        userId:    req.user.id,
        sourceGame:'seafood-market',
        kind:      listing.itemKind,
        category:  'seafood',
        name:      listing.itemName,
        icon:      listing.itemIcon,
        stats:     { ...(listing.stats || {}), rarity:listing.rarity, caughtAt:listing.caughtAt },
        qty:       1,
      },
    });
    res.json({ ok:true });
  } catch (err) { next(err); }
});

// ─── 구매 ──────────────────────────────────────────────────────────────────────
router.post('/listings/:id/buy', requireAuth, async (req, res, next) => {
  try {
    const listing = await prisma.seafoodMarketListing.findUnique({
      where:   { id:req.params.id },
      include: { stall:true },
    });
    if (!listing)        return res.status(404).json({ error:{ message:'없는 상품' } });
    if (listing.soldAt)  return res.status(400).json({ error:{ message:'이미 판매된 상품입니다.' } });
    if (listing.sellerId === req.user.id) return res.status(400).json({ error:{ message:'자신의 상품은 구매할 수 없습니다.' } });

    const price = listing.price;
    const commission = Math.round(price * commissionRate(price));
    const sellerGet  = price - commission;

    // 구매자 ALP 차감
    const ok = await spendAlp(req.user.id, price);
    if (!ok) return res.status(400).json({ error:{ message:'ALP 코인이 부족합니다.' } });

    // 판매자 ALP 지급
    await earnAlp(listing.sellerId, sellerGet);

    // 판매 완료 처리
    await prisma.seafoodMarketListing.update({
      where: { id:listing.id },
      data:  { soldAt:new Date(), buyerId:req.user.id },
    });

    // 구매자 인벤토리에 아이템 지급
    await prisma.inventoryItem.create({
      data: {
        userId:    req.user.id,
        sourceGame:'seafood-market',
        kind:      listing.itemKind,
        category:  'seafood',
        name:      listing.itemName,
        icon:      listing.itemIcon,
        stats:     { ...(listing.stats || {}), rarity:listing.rarity, caughtAt:listing.caughtAt, boughtFrom:listing.stall.name },
        qty:       1,
      },
    });

    const buyerAlp = await prisma.user.findUnique({ where:{ id:req.user.id }, select:{ alpCoins:true } });
    res.json({ ok:true, price, commission, sellerGet, alpCoins: Number(buyerAlp?.alpCoins ?? 0) });
  } catch (err) { next(err); }
});

// ─── 즉시판매 ─────────────────────────────────────────────────────────────────
router.post('/quick-sell', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({
      itemKind: z.string(),
      itemName: z.string(),
      rarity:   z.string().optional(),
      caughtAt: z.string().optional(),
    });
    const { itemKind, itemName, rarity, caughtAt } = schema.parse(req.body);

    const base   = QUICK_BASE[rarity ?? 'n'] ?? 50;
    const fresh  = freshnessFactor(caughtAt);
    const earned = Math.max(1, Math.round(base * fresh));

    await earnAlp(req.user.id, earned);
    const user = await prisma.user.findUnique({ where:{ id:req.user.id }, select:{ alpCoins:true } });
    res.json({ ok:true, earned, fresh: Math.round(fresh*100), alpCoins: Number(user?.alpCoins ?? 0) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error:{ message:err.issues?.[0]?.message } });
    next(err);
  }
});

module.exports = router;
