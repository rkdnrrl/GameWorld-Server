const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

router.get('/save', requireAuth, async (req, res, next) => {
  try {
    const row = await prisma.dungeonSave.findUnique({ where: { userId: req.user.id } });
    res.json({ save: row ? row.data : null });
  } catch (err) {
    next(err);
  }
});

router.post('/save', requireAuth, async (req, res, next) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: { message: 'data required' } });
    const row = await prisma.dungeonSave.upsert({
      where:  { userId: req.user.id },
      update: { data },
      create: { userId: req.user.id, data },
    });

    // 장착 장비의 현재 내구도를 CraftedEquipment에 동기화 (fire-and-forget)
    syncEquipmentDurability(req.user.id, data).catch((e) =>
      console.warn('[dungeon/save] 내구도 동기화 실패:', e?.message),
    );

    res.json({ ok: true, savedAt: row.savedAt });
  } catch (err) {
    next(err);
  }
});

async function syncEquipmentDurability(userId, saveData) {
  const slots = saveData?.player?.equippedSlots;
  if (!slots || typeof slots !== 'object') return;

  const updates = [];
  for (const slotData of Object.values(slots)) {
    if (!slotData || typeof slotData !== 'object') continue;
    const equipId = slotData.equip?.id;
    const curDur = slotData.curDur;
    if (!equipId || curDur == null || !Number.isFinite(Number(curDur))) continue;
    updates.push({ id: String(equipId), durability: Math.max(0, Math.round(Number(curDur))) });
  }
  if (updates.length === 0) return;

  const ids = updates.map((u) => u.id);
  const rows = await prisma.craftedEquipment.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, stats: true },
  });

  await Promise.all(
    rows.map((eq) => {
      const upd = updates.find((u) => u.id === eq.id);
      if (!upd) return;
      const newStats = { ...(eq.stats || {}), durability: upd.durability };
      return prisma.craftedEquipment.update({ where: { id: eq.id }, data: { stats: newStats } });
    }),
  );
}

router.delete('/save', requireAuth, async (req, res, next) => {
  try {
    await prisma.dungeonSave.deleteMany({ where: { userId: req.user.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
