/**
 * 범용 인벤토리 API — 게임 간 자유롭게 공유되는 아이템 저장소.
 *
 * 어떤 official 게임이든 자기 토큰으로 호출 가능:
 *   POST   /api/inventory                    — 단일 또는 배열 추가
 *   GET    /api/inventory                    — 필터 조회 (?category, ?kind, ?sourceGame, ?tags, ?limit)
 *   GET    /api/inventory/:id                — 단일 조회
 *   PATCH  /api/inventory/:id                — qty/stats/tags/name/icon 수정
 *   POST   /api/inventory/:id/consume        — 수량 차감 (0 이면 자동 삭제)
 *   DELETE /api/inventory/:id                — 강제 삭제
 *
 * 본인 아이템만 조작 가능 (다른 user 아이템 접근 시 404).
 * BigInt id 는 응답 시 문자열로 직렬화.
 */

const { Router } = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');

const router = Router();

/**
 * 공식 게임 검증 미들웨어.
 * - X-Game-Slug 헤더 필수
 * - 해당 slug의 게임이 kind=official, status=published 이어야 통과
 * - req.gameSlug 에 slug 주입
 */
async function requireOfficialGame(req, res, next) {
  const slug = String(req.headers['x-game-slug'] || '').trim().toLowerCase();
  if (!slug) {
    return res.status(400).json({ error: { message: '아이템 생성/수정은 공식 게임에서만 가능합니다. (X-Game-Slug 헤더 필요)' } });
  }
  try {
    const game = await prisma.game.findUnique({
      where: { slug },
      select: { kind: true, status: true },
    });
    if (!game || game.kind !== 'official' || game.status !== 'published') {
      return res.status(403).json({ error: { message: '공식(official) 게임에서만 아이템을 생성·수정할 수 있습니다.' } });
    }
    req.gameSlug = slug;
    next();
  } catch (err) { next(err); }
}

const MAX_BATCH = 50;
const MAX_LIMIT = 200;

const itemCreateSchema = z.object({
  // sourceGame 은 서버가 X-Game-Slug 에서 자동 주입 — 클라이언트 값 무시
  kind:       z.string().min(1).max(80),
  category:   z.string().min(1).max(40),
  name:       z.string().min(1).max(120),
  icon:       z.string().max(16).optional(),
  tags:       z.array(z.string().min(1).max(40)).max(20).optional(),
  stats:      z.record(z.unknown()).optional(),
  qty:        z.number().int().min(1).max(1_000_000).optional(),
});

const itemPatchSchema = z.object({
  name:  z.string().min(1).max(120).optional(),
  icon:  z.string().max(16).nullable().optional(),
  tags:  z.array(z.string().min(1).max(40)).max(20).optional(),
  stats: z.record(z.unknown()).optional(),
  qty:   z.number().int().min(0).max(1_000_000).optional(),
});

const consumeSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000).default(1),
});

/** BigInt id → string, Date → ISO. (JSON.stringify 가 BigInt 못 다뤄서 명시 변환.) */
function serializeItem(row) {
  if (!row) return row;
  return {
    id:         String(row.id),
    userId:     row.userId,
    sourceGame: row.sourceGame,
    kind:       row.kind,
    category:   row.category,
    name:       row.name,
    icon:       row.icon,
    tags:       row.tags || [],
    stats:      row.stats || {},
    qty:        row.qty,
    createdAt:  row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt:  row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

function parseBigIntParam(raw) {
  const s = String(raw || '').trim();
  if (!/^\d+$/.test(s)) return null;
  try { return BigInt(s); } catch { return null; }
}

/**
 * POST /api/inventory  (공식 게임만)
 *   body: 단일 아이템 객체 또는 { items: [...] } 배열
 *   sourceGame 은 X-Game-Slug 에서 자동 설정됨
 */
router.post('/', requireAuth, requireOfficialGame, async (req, res, next) => {
  try {
    const body = req.body;
    const rawList = Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body)
        ? body
        : [body];
    if (rawList.length === 0) {
      return res.status(400).json({ error: { message: '아이템 데이터가 비어있습니다.' } });
    }
    if (rawList.length > MAX_BATCH) {
      return res.status(400).json({ error: { message: `한 번에 최대 ${MAX_BATCH}개까지 추가 가능합니다.` } });
    }

    const validated = rawList.map((it) => itemCreateSchema.parse(it));
    const data = validated.map((it) => ({
      userId:     req.user.id,
      sourceGame: req.gameSlug,   // X-Game-Slug 에서 자동 주입 (클라이언트 위조 불가)
      kind:       it.kind,
      category:   it.category,
      name:       it.name,
      icon:       it.icon ?? null,
      tags:       it.tags ?? [],
      stats:      it.stats ?? {},
      qty:        it.qty ?? 1,
    }));

    // createMany 는 반환값이 count 뿐이라 개별 INSERT 로 row 받기
    const created = await prisma.$transaction(
      data.map((d) => prisma.inventoryItem.create({ data: d })),
    );
    res.status(201).json({ items: created.map(serializeItem) });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 검증 실패' } });
    }
    next(err);
  }
});

/**
 * GET /api/inventory
 *   query: category, kind, sourceGame, tags (comma-separated), limit, offset
 *   응답: { items: [...], total }
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const limit  = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const where = { userId: req.user.id };
    if (req.query.category)   where.category   = String(req.query.category);
    if (req.query.kind)       where.kind       = String(req.query.kind);
    if (req.query.sourceGame) where.sourceGame = String(req.query.sourceGame);
    if (req.query.tags) {
      const tagList = String(req.query.tags).split(',').map((t) => t.trim()).filter(Boolean);
      if (tagList.length) where.tags = { hasSome: tagList };
    }

    const [items, total] = await prisma.$transaction([
      prisma.inventoryItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.inventoryItem.count({ where }),
    ]);
    res.json({ items: items.map(serializeItem), total });
  } catch (err) {
    next(err);
  }
});

/** GET /api/inventory/:id */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseBigIntParam(req.params.id);
    if (id == null) return res.status(404).json({ error: { message: '아이템을 찾을 수 없습니다.' } });
    const row = await prisma.inventoryItem.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!row) return res.status(404).json({ error: { message: '아이템을 찾을 수 없습니다.' } });
    res.json({ item: serializeItem(row) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/inventory/:id */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseBigIntParam(req.params.id);
    if (id == null) return res.status(404).json({ error: { message: '아이템을 찾을 수 없습니다.' } });
    const patch = itemPatchSchema.parse(req.body || {});
    const existing = await prisma.inventoryItem.findFirst({
      where: { id, userId: req.user.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: { message: '아이템을 찾을 수 없습니다.' } });

    // qty=0 이면 삭제
    if (patch.qty === 0) {
      await prisma.inventoryItem.delete({ where: { id } });
      return res.json({ ok: true, deleted: true });
    }

    const updated = await prisma.inventoryItem.update({
      where: { id },
      data: patch,
    });
    res.json({ item: serializeItem(updated) });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 검증 실패' } });
    }
    next(err);
  }
});

/** POST /api/inventory/:id/consume — 수량 차감 */
router.post('/:id/consume', requireAuth, async (req, res, next) => {
  try {
    const id = parseBigIntParam(req.params.id);
    if (id == null) return res.status(404).json({ error: { message: '아이템을 찾을 수 없습니다.' } });
    const { amount } = consumeSchema.parse(req.body || {});

    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.inventoryItem.findFirst({
        where: { id, userId: req.user.id },
      });
      if (!row) return { notFound: true };
      if (row.qty < amount) return { insufficient: true, qty: row.qty };

      const newQty = row.qty - amount;
      if (newQty === 0) {
        await tx.inventoryItem.delete({ where: { id } });
        return { deleted: true };
      }
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: { qty: newQty },
      });
      return { item: updated };
    });

    if (result.notFound) {
      return res.status(404).json({ error: { message: '아이템을 찾을 수 없습니다.' } });
    }
    if (result.insufficient) {
      return res.status(409).json({ error: { message: `수량 부족 (보유 ${result.qty})` } });
    }
    if (result.deleted) return res.json({ ok: true, deleted: true });
    res.json({ item: serializeItem(result.item) });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력 검증 실패' } });
    }
    next(err);
  }
});

/** DELETE /api/inventory/:id */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseBigIntParam(req.params.id);
    if (id == null) return res.status(404).json({ error: { message: '아이템을 찾을 수 없습니다.' } });
    const existing = await prisma.inventoryItem.findFirst({
      where: { id, userId: req.user.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: { message: '아이템을 찾을 수 없습니다.' } });
    await prisma.inventoryItem.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
