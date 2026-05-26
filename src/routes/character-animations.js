'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();
const operatorRouter = Router();

const SLOTS = ['idle', 'walk', 'run', 'jump', 'crouch', 'prone'];

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "character_animation_slots" (
      slot TEXT PRIMARY KEY,
      name TEXT,
      "assetId" TEXT,
      "modelUrl" TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      "updatedBy" TEXT,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function serialize(row) {
  return {
    slot: row.slot,
    name: row.name,
    assetId: row.assetId,
    modelUrl: row.modelUrl,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  };
}

function normalizeSlot(input) {
  const slot = String(input || '').trim().toLowerCase();
  return SLOTS.includes(slot) ? slot : null;
}

function isValidFbxUrl(input) {
  const url = String(input || '').trim();
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) return false;
  return /\.fbx(?:[?#].*)?$/i.test(url);
}

async function listSlots(includeDisabled = false) {
  await ensureTable();
  const rows = await prisma.$queryRaw`
    SELECT slot, name, "assetId", "modelUrl", enabled, "updatedAt"
    FROM "character_animation_slots"
    WHERE ${includeDisabled} = true OR enabled = true
    ORDER BY
      CASE slot
        WHEN 'idle' THEN 1
        WHEN 'walk' THEN 2
        WHEN 'run' THEN 3
        WHEN 'jump' THEN 4
        WHEN 'crouch' THEN 5
        WHEN 'prone' THEN 6
        ELSE 99
      END
  `;

  const bySlot = {};
  for (const row of rows) bySlot[row.slot] = serialize(row);
  return { slots: bySlot, order: SLOTS };
}

router.get('/', async (_req, res, next) => {
  try {
    res.json(await listSlots(false));
  } catch (err) {
    next(err);
  }
});

operatorRouter.get('/', requireAuth, requireOperator, async (_req, res, next) => {
  try {
    res.json(await listSlots(true));
  } catch (err) {
    next(err);
  }
});

operatorRouter.put('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    await ensureTable();
    const input = req.body?.slots || {};
    const saved = [];

    for (const [rawSlot, rawValue] of Object.entries(input)) {
      const slot = normalizeSlot(rawSlot);
      if (!slot) continue;

      const value = rawValue && typeof rawValue === 'object' ? rawValue : {};
      const enabled = value.enabled !== false;
      const modelUrl = String(value.modelUrl || value.url || '').trim();
      const name = value.name ? String(value.name).slice(0, 80) : null;
      const assetId = value.assetId ? String(value.assetId).slice(0, 120) : null;

      if (enabled && !isValidFbxUrl(modelUrl)) {
        return res.status(400).json({ error: { message: `Invalid FBX URL for ${slot}.` } });
      }
      if (!enabled && !modelUrl) {
        await prisma.$executeRaw`
          UPDATE "character_animation_slots"
          SET enabled = false, "updatedBy" = ${req.user.id}, "updatedAt" = NOW()
          WHERE slot = ${slot}
        `;
        continue;
      }

      await prisma.$executeRaw`
        INSERT INTO "character_animation_slots" (slot, name, "assetId", "modelUrl", enabled, "updatedBy", "updatedAt")
        VALUES (${slot}, ${name}, ${assetId}, ${modelUrl}, ${enabled}, ${req.user.id}, NOW())
        ON CONFLICT (slot) DO UPDATE SET
          name = EXCLUDED.name,
          "assetId" = EXCLUDED."assetId",
          "modelUrl" = EXCLUDED."modelUrl",
          enabled = EXCLUDED.enabled,
          "updatedBy" = EXCLUDED."updatedBy",
          "updatedAt" = NOW()
      `;
      saved.push(slot);
    }

    const result = await listSlots(true);
    res.json({ ok: true, saved, ...result });
  } catch (err) {
    next(err);
  }
});

operatorRouter.delete('/:slot', requireAuth, requireOperator, async (req, res, next) => {
  try {
    await ensureTable();
    const slot = normalizeSlot(req.params.slot);
    if (!slot) return res.status(400).json({ error: { message: 'Invalid slot.' } });
    await prisma.$executeRaw`
      UPDATE "character_animation_slots"
      SET enabled = false, "updatedBy" = ${req.user.id}, "updatedAt" = NOW()
      WHERE slot = ${slot}
    `;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, operatorRouter, SLOTS, ensureTable };
