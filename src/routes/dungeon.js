const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();
const MOVE_BASE_MS = 220;

router.get('/save', requireAuth, async (req, res, next) => {
  try {
    const row = await prisma.dungeonSave.findUnique({ where: { userId: req.user.id } });
    if (!row || !row.data) return res.json({ save: null });
    let cleaned = row.data;
    try { cleaned = await stripDeletedEquipment(req.user.id, row.data); } catch (e) { console.error('[stripDeletedEquipment]', e); }
    try { cleaned = await refreshEquipmentDurability(req.user.id, cleaned); } catch (e) { console.error('[refreshEquipmentDurability]', e); }
    res.json({ save: cleaned });
  } catch (err) {
    next(err);
  }
});

async function stripDeletedEquipment(userId, saveData) {
  const p = saveData?.player;
  if (!p) return saveData;

  const ids = new Set();
  if (p.equipment?.id != null) ids.add(String(p.equipment.id));
  for (const wrapper of Object.values(p.equippedSlots || {})) {
    const id = wrapper?.equip?.id ?? wrapper?.id;
    if (id != null) ids.add(String(id));
  }
  for (const item of (p.inventory || [])) {
    if (item?.equip?.id != null) ids.add(String(item.equip.id));
  }
  if (ids.size === 0) return saveData;

  const existing = await prisma.craftedEquipment.findMany({
    where: { id: { in: [...ids] }, userId },
    select: { id: true },
  });
  const existingSet = new Set(existing.map((e) => String(e.id)));
  if (existingSet.size === ids.size) return saveData;

  const data = JSON.parse(JSON.stringify(saveData));
  const pl = data.player;

  if (pl.equipment?.id != null && !existingSet.has(String(pl.equipment.id))) {
    pl.equipment = null;
    pl.durability = 0;
    pl.durabilityMax = 0;
    pl.durBroken = false;
  }
  for (const slotId of Object.keys(pl.equippedSlots || {})) {
    const wrapper = pl.equippedSlots[slotId];
    const id = wrapper?.equip?.id ?? wrapper?.id;
    if (id != null && !existingSet.has(String(id))) delete pl.equippedSlots[slotId];
  }
  if (Array.isArray(pl.inventory)) {
    pl.inventory = pl.inventory.filter((item) =>
      item?.equip?.id == null || existingSet.has(String(item.equip.id)),
    );
  }

  // 제거된 장비 반영해 스탯 재계산
  let atkSum = 0, defSum = 0, spdSum = 0, hpSum = 0;
  for (const wrapper of Object.values(pl.equippedSlots || {})) {
    if ((wrapper?.curDur ?? 1) <= 0) continue;
    const s = (wrapper?.equip || wrapper)?.stats || {};
    atkSum += s.attackBonus  || 0;
    defSum += s.defenseBonus || 0;
    spdSum += s.speedBonus   || 0;
    hpSum  += s.hpBonus      || 0;
  }
  if (pl.equipment) {
    const ws = pl.equipment.stats || {};
    const broken = !!pl.durBroken;
    pl.baseAtk   = 5 + atkSum + (broken ? 0 : (ws.attackBonus  || 0));
    pl.baseDef   = defSum +     (broken ? Math.floor((ws.defenseBonus || 0) / 2) : (ws.defenseBonus || 0));
    pl.moveDelay = Math.round(MOVE_BASE_MS * (1 - Math.min(0.5, spdSum + (ws.speedBonus || 0))));
  } else {
    pl.baseAtk   = 5 + atkSum;
    pl.baseDef   = defSum;
    pl.moveDelay = Math.round(MOVE_BASE_MS * (1 - Math.min(0.5, spdSum)));
  }
  pl.maxHp = Math.max(50, 100 + pl.baseDef * 5 + hpSum);
  pl.hp    = Math.min(pl.hp, pl.maxHp);

  return data;
}

// 로드 시 DB의 최신 내구도로 세이브 데이터 갱신 (대장간 수리 반영)
async function refreshEquipmentDurability(userId, saveData) {
  const p = saveData?.player;
  if (!p) return saveData;

  const ids = new Set();
  if (p.equipment?.id != null) ids.add(String(p.equipment.id));
  for (const wrapper of Object.values(p.equippedSlots || {})) {
    const id = wrapper?.equip?.id ?? wrapper?.id;
    if (id != null) ids.add(String(id));
  }
  if (ids.size === 0) return saveData;

  const rows = await prisma.craftedEquipment.findMany({
    where: { id: { in: [...ids] }, userId },
    select: { id: true, stats: true },
  });
  if (rows.length === 0) return saveData;

  const statMap = new Map(rows.map((r) => [String(r.id), r.stats || {}]));
  const data = JSON.parse(JSON.stringify(saveData));
  const pl = data.player;

  // 무기 내구도 갱신
  if (pl.equipment?.id != null) {
    const s = statMap.get(String(pl.equipment.id));
    if (s) {
      const dbDur = s.durability != null ? Number(s.durability) : null;
      const dbMax = s.durabilityMax != null ? Number(s.durabilityMax) : null;
      if (dbDur != null) {
        pl.durability = dbDur;
        if (pl.equipment.stats) pl.equipment.stats.durability = dbDur;
      }
      if (dbMax != null) {
        pl.durabilityMax = dbMax;
        if (pl.equipment.stats) pl.equipment.stats.durabilityMax = dbMax;
      }
      if (dbDur != null && dbDur > 0) pl.durBroken = false;
    }
  }

  // 방어구 슬롯 내구도 갱신
  for (const slotId of Object.keys(pl.equippedSlots || {})) {
    const wrapper = pl.equippedSlots[slotId];
    const equipId = wrapper?.equip?.id ?? wrapper?.id;
    if (equipId == null) continue;
    const s = statMap.get(String(equipId));
    if (!s) continue;
    const dbDur = s.durability != null ? Number(s.durability) : null;
    const dbMax = s.durabilityMax != null ? Number(s.durabilityMax) : null;
    if (dbDur != null) {
      wrapper.curDur = dbDur;
      if (wrapper.equip?.stats) wrapper.equip.stats.durability = dbDur;
    }
    if (dbMax != null) {
      wrapper.maxDur = dbMax;
      if (wrapper.equip?.stats) wrapper.equip.stats.durabilityMax = dbMax;
    }
  }

  return data;
}

router.post('/save', requireAuth, async (req, res, next) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: { message: 'data required' } });

    // 강화 아이템 드롭 판정을 위해 기존 세이브의 킬 수 조회
    const existing = await prisma.dungeonSave.findUnique({ where: { userId: req.user.id } });
    const prevKills = existing?.data?.player?.kills ?? 0;
    const newKills  = data?.player?.kills ?? 0;
    const killDiff  = Math.max(0, Math.floor(newKills) - Math.floor(prevKills));

    const row = await prisma.dungeonSave.upsert({
      where:  { userId: req.user.id },
      update: { data },
      create: { userId: req.user.id, data },
    });

    // 장착 장비의 현재 내구도를 CraftedEquipment에 동기화
    await syncEquipmentDurability(req.user.id, data);

    // 킬 당 강화 아이템 드롭 판정 (누적 드롭 후 일괄 upsert)
    const drops = {};
    for (let i = 0; i < killDiff; i++) {
      const r = Math.random();
      if      (r < 0.002) drops.shard_legend   = (drops.shard_legend   || 0) + 1;
      else if (r < 0.012) drops.crystal_magic  = (drops.crystal_magic  || 0) + 1;
      else if (r < 0.052) drops.stone_rare     = (drops.stone_rare     || 0) + 1;
      else if (r < 0.252) drops.stone_common   = (drops.stone_common   || 0) + 1;
    }
    const dropEntries = Object.entries(drops);
    if (dropEntries.length > 0) {
      await Promise.all(dropEntries.map(([itemType, count]) =>
        prisma.enhancementStock.upsert({
          where:  { userId_itemType: { userId: req.user.id, itemType } },
          create: { userId: req.user.id, itemType, count },
          update: { count: { increment: count } },
        }),
      ));
    }

    res.json({ ok: true, savedAt: row.savedAt, enhancementDrops: drops });
  } catch (err) {
    next(err);
  }
});

async function syncEquipmentDurability(userId, saveData) {
  const playerData = saveData?.player;
  if (!playerData) return;

  const updates = [];

  // 방어구: equippedSlots[slotId] = { equip, curDur, maxDur }
  const slots = playerData.equippedSlots;
  if (slots && typeof slots === 'object') {
    for (const slotData of Object.values(slots)) {
      if (!slotData || typeof slotData !== 'object') continue;
      const equipId = slotData.equip?.id;
      const curDur = slotData.curDur;
      if (!equipId || curDur == null || !Number.isFinite(Number(curDur))) continue;
      updates.push({ id: String(equipId), durability: Math.max(0, Math.round(Number(curDur))) });
    }
  }

  // 무기: player.equipment.id + player.durability (equippedSlots와 별도 관리)
  const weaponId = playerData.equipment?.id;
  const weaponDur = playerData.durability;
  if (weaponId && weaponDur != null && Number.isFinite(Number(weaponDur))) {
    const wid = String(weaponId);
    if (!updates.find((u) => u.id === wid)) {
      updates.push({ id: wid, durability: Math.max(0, Math.round(Number(weaponDur))) });
    }
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

// 장비 내구도 직접 동기화 (휴식층 진입 시 호출)
router.post('/sync-durability', requireAuth, async (req, res, next) => {
  try {
    const { weapon, armor } = req.body || {};
    const updates = [];

    if (weapon?.id && weapon.durability != null && Number.isFinite(Number(weapon.durability))) {
      updates.push({ id: String(weapon.id), durability: Math.max(0, Math.round(Number(weapon.durability))) });
    }
    if (Array.isArray(armor)) {
      for (const a of armor) {
        if (!a?.id || a.durability == null || !Number.isFinite(Number(a.durability))) continue;
        if (!updates.find((u) => u.id === String(a.id))) {
          updates.push({ id: String(a.id), durability: Math.max(0, Math.round(Number(a.durability))) });
        }
      }
    }

    if (updates.length === 0) return res.json({ ok: true, synced: 0 });

    const ids = updates.map((u) => u.id);
    const rows = await prisma.craftedEquipment.findMany({
      where: { id: { in: ids }, userId: req.user.id },
      select: { id: true, stats: true },
    });

    await Promise.all(rows.map((eq) => {
      const upd = updates.find((u) => u.id === eq.id);
      if (!upd) return;
      const newStats = { ...(eq.stats || {}), durability: upd.durability };
      return prisma.craftedEquipment.update({ where: { id: eq.id }, data: { stats: newStats } });
    }));

    res.json({ ok: true, synced: rows.length });
  } catch (err) {
    next(err);
  }
});

// 던전 종료: 내구도 동기화 + 세이브 삭제를 원자적으로 처리
router.post('/exit', requireAuth, async (req, res, next) => {
  try {
    const { data } = req.body;
    if (data) {
      await syncEquipmentDurability(req.user.id, data);
    } else {
      // data 없으면 마지막 저장된 세이브에서 동기화
      const existing = await prisma.dungeonSave.findUnique({ where: { userId: req.user.id } });
      if (existing?.data) await syncEquipmentDurability(req.user.id, existing.data);
    }
    await prisma.dungeonSave.deleteMany({ where: { userId: req.user.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/save', requireAuth, async (req, res, next) => {
  try {
    // 삭제 전 마지막 저장 데이터로 내구도 동기화
    const existing = await prisma.dungeonSave.findUnique({ where: { userId: req.user.id } });
    if (existing?.data) {
      await syncEquipmentDurability(req.user.id, existing.data);
    }
    await prisma.dungeonSave.deleteMany({ where: { userId: req.user.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
