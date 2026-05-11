const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

/* ── 상수 ──────────────────────────────────────────────── */
const VOXEL_GRID = 32;
const MAX_VOXELS = 10000;
const FEE_RATE   = 0.15;
const FEE_MIN    = 5;

function calcFee(price) {
  return Math.max(FEE_MIN, Math.ceil(price * FEE_RATE));
}

function validateVoxels(voxels) {
  if (!Array.isArray(voxels))       return false;
  if (voxels.length > MAX_VOXELS)   return false;
  for (const v of voxels) {
    if (
      typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number' ||
      v.x < 0 || v.x >= VOXEL_GRID ||
      v.y < 0 || v.y >= VOXEL_GRID ||
      v.z < 0 || v.z >= VOXEL_GRID ||
      typeof v.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.color)
    ) return false;
  }
  return true;
}

const SEL_OBJ = {
  id: true, name: true, price: true, voxels: true,
  createdAt: true, updatedAt: true,
};
const SEL_PLACE = {
  id: true, voxelObjectId: true,
  posX: true, posZ: true, rotY: true, placedAt: true,
};

/* ══════════════════════════════════════════════════════════
   복셀 오브젝트 CRUD
══════════════════════════════════════════════════════════ */

// GET /api/voxels — 내 작품 목록
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const objects = await prisma.voxelObject.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'asc' },
      select: SEL_OBJ,
    });
    res.json({ objects });
  } catch (err) { next(err); }
});

// POST /api/voxels — 신규 작품 등록 (수수료 차감)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, price, voxels } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 50)
      return res.status(400).json({ error: { message: '이름이 올바르지 않습니다.' } });

    const priceNum = Math.floor(Number(price));
    if (!Number.isFinite(priceNum) || priceNum < 1 || priceNum > 9999)
      return res.status(400).json({ error: { message: '가격은 1~9999 코인이어야 합니다.' } });

    if (!validateVoxels(voxels))
      return res.status(400).json({ error: { message: '복셀 데이터가 올바르지 않습니다.' } });
    if (voxels.length === 0)
      return res.status(400).json({ error: { message: '복셀을 하나 이상 추가해 주세요.' } });

    const fee = calcFee(priceNum);
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }, select: { coins: true },
    });
    if (!user || user.coins < fee)
      return res.status(400).json({ error: { message: `코인이 부족합니다. 등록 수수료 ${fee} 코인이 필요합니다.` } });

    const [object, updated] = await prisma.$transaction([
      prisma.voxelObject.create({
        data: { userId: req.user.id, name: name.trim(), price: priceNum, voxels },
        select: SEL_OBJ,
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { coins: { decrement: fee } },
        select: { coins: true },
      }),
    ]);

    res.json({ object, fee, coins: updated.coins });
  } catch (err) { next(err); }
});

// PUT /api/voxels/:id — 작품 수정 (수수료 차감)
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.voxelObject.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing)
      return res.status(404).json({ error: { message: '오브젝트를 찾을 수 없습니다.' } });

    const { name, price, voxels } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 50)
      return res.status(400).json({ error: { message: '이름이 올바르지 않습니다.' } });

    const priceNum = Math.floor(Number(price));
    if (!Number.isFinite(priceNum) || priceNum < 1 || priceNum > 9999)
      return res.status(400).json({ error: { message: '가격은 1~9999 코인이어야 합니다.' } });

    if (!validateVoxels(voxels))
      return res.status(400).json({ error: { message: '복셀 데이터가 올바르지 않습니다.' } });
    if (voxels.length === 0)
      return res.status(400).json({ error: { message: '복셀을 하나 이상 추가해 주세요.' } });

    const fee = calcFee(priceNum);
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }, select: { coins: true },
    });
    if (!user || user.coins < fee)
      return res.status(400).json({ error: { message: `코인이 부족합니다. 수정 수수료 ${fee} 코인이 필요합니다.` } });

    const [object, updated] = await prisma.$transaction([
      prisma.voxelObject.update({
        where: { id: req.params.id },
        data: { name: name.trim(), price: priceNum, voxels },
        select: SEL_OBJ,
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { coins: { decrement: fee } },
        select: { coins: true },
      }),
    ]);

    res.json({ object, fee, coins: updated.coins });
  } catch (err) { next(err); }
});

// DELETE /api/voxels/:id — 작품 삭제 (배치도 cascade 삭제)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.voxelObject.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing)
      return res.status(404).json({ error: { message: '오브젝트를 찾을 수 없습니다.' } });

    await prisma.voxelObject.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   배치 (VoxelPlacement)
══════════════════════════════════════════════════════════ */

// GET /api/voxels/placements — 내 배치 목록
router.get('/placements', requireAuth, async (req, res, next) => {
  try {
    const placements = await prisma.voxelPlacement.findMany({
      where: { userId: req.user.id },
      orderBy: { placedAt: 'asc' },
      select: SEL_PLACE,
    });
    res.json({ placements });
  } catch (err) { next(err); }
});

// POST /api/voxels/placements — 방에 배치
router.post('/placements', requireAuth, async (req, res, next) => {
  try {
    const { voxelObjectId, posX, posZ, rotY } = req.body;
    const obj = await prisma.voxelObject.findFirst({
      where: { id: voxelObjectId, userId: req.user.id },
    });
    if (!obj)
      return res.status(404).json({ error: { message: '내 오브젝트만 배치할 수 있습니다.' } });

    const placement = await prisma.voxelPlacement.create({
      data: {
        userId: req.user.id,
        voxelObjectId,
        posX: Number(posX) || 0,
        posZ: Number(posZ) || 0,
        rotY: Number(rotY) || 0,
      },
      select: SEL_PLACE,
    });
    res.json({ placement });
  } catch (err) { next(err); }
});

// PATCH /api/voxels/placements/:id/move — 배치 위치 이동
router.patch('/placements/:id/move', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.voxelPlacement.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing)
      return res.status(404).json({ error: { message: '배치를 찾을 수 없습니다.' } });

    const { posX, posZ } = req.body;
    const placement = await prisma.voxelPlacement.update({
      where: { id: req.params.id },
      data: { posX: Number(posX) || 0, posZ: Number(posZ) || 0 },
      select: SEL_PLACE,
    });
    res.json({ placement });
  } catch (err) { next(err); }
});

// DELETE /api/voxels/placements/:id — 배치 제거
router.delete('/placements/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.voxelPlacement.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing)
      return res.status(404).json({ error: { message: '배치를 찾을 수 없습니다.' } });

    await prisma.voxelPlacement.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
