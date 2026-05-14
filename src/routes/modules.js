'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const {
  MODULE_CATALOG,
  EQUIP_MODULE_SLOTS,
  TIER_DUR,
  applyTierToStats,
  tierFromMaterialCount,
} = require('../lib/moduleCatalog');

const router = Router();

// Cost per durability point to repair, by tier
const REPAIR_COST_PER_DUR = { common: 3, rare: 8, epic: 20, legendary: 50 };

// GET /api/modules — list all user's modules
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const modules = await prisma.module.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ modules });
  } catch (err) {
    next(err);
  }
});

// GET /api/modules/for-equipment/:equipId — modules equipped on a specific piece
router.get('/for-equipment/:equipId', requireAuth, async (req, res, next) => {
  try {
    const modules = await prisma.module.findMany({
      where: { userId: req.user.id, equippedTo: req.params.equipId },
    });
    res.json({ modules });
  } catch (err) {
    next(err);
  }
});

// POST /api/modules/craft — craft a new module
router.post('/craft', requireAuth, async (req, res, next) => {
  try {
    const { moduleType, smeltMaterials } = req.body;
    if (!moduleType || !Array.isArray(smeltMaterials) || smeltMaterials.length === 0) {
      return res.status(400).json({ error: { message: 'moduleType and smeltMaterials required' } });
    }
    if (!MODULE_CATALOG[moduleType]) {
      return res.status(400).json({ error: { message: 'Unknown moduleType' } });
    }

    // Aggregate requested smelt quantities
    const needed = {};
    let totalCount = 0;
    for (const { productId, count } of smeltMaterials) {
      if (!productId || !Number.isInteger(count) || count < 1) {
        return res.status(400).json({ error: { message: 'Invalid smeltMaterials entry' } });
      }
      needed[productId] = (needed[productId] || 0) + count;
      totalCount += count;
    }

    // Verify stock
    const productIds = Object.keys(needed);
    const stockRows = await prisma.smeltStock.findMany({
      where: { userId: req.user.id, productId: { in: productIds } },
    });
    const stockMap = new Map(stockRows.map(r => [r.productId, r.count]));
    for (const [pid, cnt] of Object.entries(needed)) {
      const has = stockMap.get(pid) || 0;
      if (has < cnt) {
        return res.status(400).json({ error: { message: `재료 부족: ${pid} (보유 ${has}, 필요 ${cnt})` } });
      }
    }

    // Determine tier from total material count
    const tier = tierFromMaterialCount(totalCount);

    // Roll random variant
    const catalog = MODULE_CATALOG[moduleType];
    const variant = catalog.variants[Math.floor(Math.random() * catalog.variants.length)];
    const stats = applyTierToStats(variant.stats, tier);
    const durMax = TIER_DUR[tier];

    // Consume smelt stock and create module in a transaction
    const newModule = await prisma.$transaction(async (tx) => {
      // Deduct stock
      await Promise.all(
        Object.entries(needed).map(([pid, cnt]) =>
          tx.smeltStock.update({
            where: { userId_productId: { userId: req.user.id, productId: pid } },
            data: { count: { decrement: cnt } },
          }),
        ),
      );

      return tx.module.create({
        data: {
          userId: req.user.id,
          name: variant.name,
          moduleType,
          tier,
          keywords: variant.keywords,
          stats,
          durability: durMax,
          durabilityMax: durMax,
        },
      });
    });

    res.json({ module: newModule });
  } catch (err) {
    next(err);
  }
});

// POST /api/modules/:id/attach — attach module to equipment slot
router.post('/:id/attach', requireAuth, async (req, res, next) => {
  try {
    const { equipmentId, slot } = req.body;
    if (!equipmentId || !slot) {
      return res.status(400).json({ error: { message: 'equipmentId and slot required' } });
    }

    const mod = await prisma.module.findUnique({ where: { id: req.params.id } });
    if (!mod || mod.userId !== req.user.id) {
      return res.status(404).json({ error: { message: 'Module not found' } });
    }
    if (mod.equippedTo) {
      return res.status(400).json({ error: { message: 'Module already attached to another item' } });
    }

    // Verify equipment belongs to user and get its equipSlot
    const equip = await prisma.craftedEquipment.findUnique({
      where: { id: equipmentId },
      select: { id: true, userId: true, stats: true },
    });
    if (!equip || equip.userId !== req.user.id) {
      return res.status(404).json({ error: { message: 'Equipment not found' } });
    }

    const equipSlot = equip.stats?.equipSlot || 'weapon';
    const validSlots = EQUIP_MODULE_SLOTS[equipSlot] || [];
    if (!validSlots.includes(slot)) {
      return res.status(400).json({ error: { message: `Slot '${slot}' not valid for ${equipSlot} equipment` } });
    }

    // Check slot compatibility with module type
    const catalogEntry = MODULE_CATALOG[mod.moduleType];
    if (!catalogEntry || !catalogEntry.equipSlots.includes(equipSlot)) {
      return res.status(400).json({ error: { message: `Module type '${mod.moduleType}' cannot be attached to ${equipSlot}` } });
    }

    // Check if slot is already occupied — detach existing first
    const existing = await prisma.module.findFirst({
      where: { userId: req.user.id, equippedTo: equipmentId, equippedSlot: slot },
    });
    if (existing) {
      await prisma.module.update({
        where: { id: existing.id },
        data: { equippedTo: null, equippedSlot: null },
      });
    }

    const updated = await prisma.module.update({
      where: { id: mod.id },
      data: { equippedTo: equipmentId, equippedSlot: slot },
    });

    res.json({ module: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/modules/:id/detach — remove module from equipment
router.post('/:id/detach', requireAuth, async (req, res, next) => {
  try {
    const mod = await prisma.module.findUnique({ where: { id: req.params.id } });
    if (!mod || mod.userId !== req.user.id) {
      return res.status(404).json({ error: { message: 'Module not found' } });
    }

    const updated = await prisma.module.update({
      where: { id: mod.id },
      data: { equippedTo: null, equippedSlot: null },
    });
    res.json({ module: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/modules/:id/repair — repair module (must be detached)
router.post('/:id/repair', requireAuth, async (req, res, next) => {
  try {
    const mod = await prisma.module.findUnique({ where: { id: req.params.id } });
    if (!mod || mod.userId !== req.user.id) {
      return res.status(404).json({ error: { message: 'Module not found' } });
    }
    if (mod.equippedTo) {
      return res.status(400).json({ error: { message: '수리하려면 먼저 모듈을 장비에서 분리하세요' } });
    }
    if (mod.durability >= mod.durabilityMax) {
      return res.status(400).json({ error: { message: '이미 최대 내구도입니다' } });
    }

    const costPerDur = REPAIR_COST_PER_DUR[mod.tier] || REPAIR_COST_PER_DUR.common;
    const missing = mod.durabilityMax - mod.durability;
    const cost = Math.ceil(missing * costPerDur);

    // Check coins
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { coins: true },
    });
    if (!user || user.coins < cost) {
      return res.status(400).json({ error: { message: `코인 부족 (필요 ${cost}, 보유 ${user?.coins || 0})` } });
    }

    const [updated] = await prisma.$transaction([
      prisma.module.update({
        where: { id: mod.id },
        data: { durability: mod.durabilityMax },
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { coins: { decrement: cost } },
      }),
    ]);

    res.json({ module: updated, cost });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/modules/:id — delete a module
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const mod = await prisma.module.findUnique({ where: { id: req.params.id } });
    if (!mod || mod.userId !== req.user.id) {
      return res.status(404).json({ error: { message: 'Module not found' } });
    }
    await prisma.module.delete({ where: { id: mod.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
