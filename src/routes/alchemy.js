'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const { decomposeMaterialNamesToElements } = require('../lib/geminiAlchemyDecompose');
const { composeElementsToCompound } = require('../lib/geminiAlchemyCompose');
const { generateCatchPixelArtFromFields, resolveCatchRowPixelArt } = require('../lib/catchPixelArt');
const { generateAlchemyCompoundPixelArt } = require('../lib/pixelLabAlchemyCompoundArt');
const { normalizeElementSymbol, isValidElementSymbol } = require('../lib/periodicElementSymbols');

const router = Router();

const PIXELLAB_ALCHEMY_COMPOSE_MS = 110_000;
const SHARED_ALCHEMY_COMPOUND_PREFIX = 'shared:alchemy-compound:';

const MAX_NAMES = 16;
const MAX_NAME_LEN = 120;
const DECOMPOSE_TIMEOUT_MS = 18_000;
const COMPOSE_TIMEOUT_MS = 22_000;
const MIN_COMPOSE_SLOTS = 2;
const MAX_COMPOSE_SLOTS = 16;
const MAX_STASH_PER_SYMBOL = 999_999;

/** 테이블 미생성·구 Prisma 클라이언트 등으로 연금술 재고 API를 쓸 수 없을 때 */
function isAlchemyStashUnavailableError(err) {
  if (!err) return false;
  const code = err.code;
  const msg = String(err.message || '');
  if (code === 'P2021') return true;
  if (code === '42P01') return true;
  if (/relation ["']?alchemy_element_stock["']? does not exist/i.test(msg)) return true;
  if (/alchemy_element_stock/i.test(msg) && /does not exist|not exist/i.test(msg)) return true;
  if (/Unknown arg|Unknown field|alchemyElementStock/i.test(msg) && /Invalid/i.test(msg)) return true;
  return false;
}

function normLine(s) {
  return String(s != null ? s : '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NAME_LEN);
}

/**
 * GET /api/alchemy/stash — 분해로 쌓인 주기율표 원소 집계
 */
router.get('/stash', requireAuth, async (req, res, next) => {
  try {
    const rows = await prisma.alchemyElementStock.findMany({
      where: { userId: req.user.id, count: { gt: 0 } },
      orderBy: [{ atomicNumber: 'asc' }, { symbol: 'asc' }],
    });
    res.json({
      elements: rows.map((r) => ({
        symbol: r.symbol,
        nameKo: r.nameKo,
        atomicNumber: r.atomicNumber,
        count: r.count,
      })),
    });
  } catch (err) {
    if (isAlchemyStashUnavailableError(err)) {
      console.warn('[alchemy/stash] degraded (run prisma migrate deploy):', err.message);
      return res.json({ elements: [], meta: { stashUnavailable: true } });
    }
    next(err);
  }
});

/**
 * 분해 성공 시 원소별 재고 +1 (검증된 기호만)
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} userId
 * @param {{ symbol: string, nameKo?: string, atomicNumber?: number }[]} elements
 */
async function incrementStashForElements(tx, userId, elements) {
  for (const el of elements) {
    const sym = normalizeElementSymbol(el.symbol);
    if (!sym || !isValidElementSymbol(sym)) continue;

    let nameKo =
      typeof el.nameKo === 'string' && el.nameKo.trim() ? el.nameKo.trim().slice(0, 40) : null;
    let z = el.atomicNumber != null ? Number(el.atomicNumber) : null;
    if (!Number.isFinite(z) || z < 1 || z > 118) z = null;

    const existing = await tx.alchemyElementStock.findUnique({
      where: { userId_symbol: { userId, symbol: sym } },
      select: { count: true, nameKo: true },
    });
    const prev = existing && Number.isFinite(existing.count) ? existing.count : 0;
    const nextCount = Math.min(MAX_STASH_PER_SYMBOL, prev + 1);
    if (!nameKo && existing && existing.nameKo) nameKo = existing.nameKo;

    await tx.alchemyElementStock.upsert({
      where: { userId_symbol: { userId, symbol: sym } },
      create: {
        userId,
        symbol: sym,
        nameKo,
        atomicNumber: z,
        count: 1,
      },
      update: {
        count: nextCount,
        ...(nameKo ? { nameKo } : {}),
        ...(z != null ? { atomicNumber: z } : {}),
      },
    });
  }
}

function nameMatchesElementLine(nm, sym) {
  const n = normLine(nm).toLowerCase();
  const s = String(sym || '').trim().toLowerCase();
  if (!n || !s) return false;
  if (n.includes(`(${s})`)) return true;
  if (n.endsWith(s)) return true;
  if (n.includes(s)) return true;
  return false;
}

/**
 * 가마솥 슬롯별 서버 재료 소모 (Catch 삭제, 장비 삭제, 추출 원소 재고 차감)
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} userId
 * @param {string[]} names
 * @param {object[]} sources — slots[].source
 */
async function consumeMaterialSources(tx, userId, names, sources) {
  for (let i = 0; i < names.length; i += 1) {
    const nm = names[i];
    const src = sources[i] || {};
    const k = String(src.kind || '').toLowerCase();

    if (k === 'catch') {
      const id = String(src.id || '').trim();
      if (!id) {
        const e = new Error('catch id 없음');
        e.statusCode = 400;
        throw e;
      }
      const row = await tx.catch.findFirst({
        where: { id, userId, sold: false },
        select: { id: true, itemName: true },
      });
      if (!row) {
        const e = new Error('일부 낚시 재료를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.');
        e.statusCode = 400;
        throw e;
      }
      if (normLine(row.itemName) !== normLine(nm)) {
        const e = new Error('재료 이름이 서버와 일치하지 않습니다.');
        e.statusCode = 400;
        throw e;
      }
      await tx.catch.delete({ where: { id: row.id } });
      continue;
    }

    if (k === 'equipment') {
      const id = String(src.id || '').trim();
      if (!id) {
        const e = new Error('장비 id 없음');
        e.statusCode = 400;
        throw e;
      }
      const row = await tx.craftedEquipment.findFirst({
        where: { id, userId },
        select: { id: true, name: true },
      });
      if (!row) {
        const e = new Error('일부 장비를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.');
        e.statusCode = 400;
        throw e;
      }
      if (normLine(row.name) !== normLine(nm)) {
        const e = new Error('장비 이름이 서버와 일치하지 않습니다.');
        e.statusCode = 400;
        throw e;
      }
      await tx.craftedEquipment.delete({ where: { id: row.id } });
      continue;
    }

    if (k === 'alchemy_element') {
      const sym = normalizeElementSymbol(src.symbol);
      if (!sym || !isValidElementSymbol(sym)) {
        const e = new Error('추출 원소 기호가 올바르지 않습니다.');
        e.statusCode = 400;
        throw e;
      }
      if (!nameMatchesElementLine(nm, sym)) {
        const e = new Error('추출 원소 줄의 이름이 기호와 맞지 않습니다.');
        e.statusCode = 400;
        throw e;
      }
      const row = await tx.alchemyElementStock.findUnique({
        where: { userId_symbol: { userId, symbol: sym } },
        select: { count: true },
      });
      if (!row || !Number.isFinite(row.count) || row.count < 1) {
        const e = new Error('추출 원소 재고가 부족합니다.');
        e.statusCode = 400;
        throw e;
      }
      const want = Math.max(1, Math.floor(Number(src.qty)) || 1);
      const use = Math.min(row.count, want);
      const next = row.count - use;
      if (next <= 0) {
        await tx.alchemyElementStock.delete({ where: { userId_symbol: { userId, symbol: sym } } });
      } else {
        await tx.alchemyElementStock.update({
          where: { userId_symbol: { userId, symbol: sym } },
          data: { count: next },
        });
      }
      continue;
    }

    const e = new Error('서버에 등록된 재료·장비·추출 원소만 분해할 수 있습니다.');
    e.statusCode = 400;
    throw e;
  }
}

/**
 * POST /api/alchemy/decompose
 * body.slots: { name: string, source: { kind, id?, symbol?, qty? } }[] — 가마솥 순서와 동일 (소모 검증)
 * body.names: (레거시) string[] — 소모 없이 AI만 (원소 적립 시 클라이언트 업데이트 권장)
 */
router.post('/decompose', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    let names = [];
    /** @type {object[] | null} */
    let sources = null;

    if (Array.isArray(body.slots) && body.slots.length > 0) {
      sources = [];
      for (const slot of body.slots) {
        if (names.length >= MAX_NAMES) break;
        const nm = normLine(slot && slot.name != null ? slot.name : '');
        if (!nm) {
          return res.status(400).json({ error: { message: '슬롯 이름이 비어 있습니다.' } });
        }
        names.push(nm);
        sources.push(slot && slot.source && typeof slot.source === 'object' ? slot.source : {});
      }
      for (const src of sources) {
        const k = String(src.kind || '').toLowerCase();
        if (k === 'local' || !k) {
          return res.status(400).json({
            error: { message: '서버에 없는 재료는 분해할 수 없습니다. 게임월드에서 연 금술만 이용해 주세요.' },
          });
        }
      }
    } else if (Array.isArray(body.names)) {
      const raw = body.names;
      for (const x of raw) {
        if (names.length >= MAX_NAMES) break;
        const s = normLine(x);
        if (s) names.push(s);
      }
    } else {
      return res.status(400).json({ error: { message: 'slots 또는 names 배열이 필요합니다.' } });
    }

    if (names.length === 0) {
      return res.status(400).json({ error: { message: '최소 한 개의 재료 이름이 필요합니다.' } });
    }

    if (sources && sources.length !== names.length) {
      return res.status(400).json({ error: { message: 'slots와 이름 개수가 맞지 않습니다.' } });
    }

    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), DECOMPOSE_TIMEOUT_MS);
    let result;
    try {
      result = await decomposeMaterialNamesToElements(names, { signal: ac.signal });
    } finally {
      clearTimeout(tid);
    }

    if (!result) {
      return res.status(503).json({ error: { message: 'AI 키가 설정되어 있지 않습니다.' } });
    }

    if (result.reason === 'timeout') {
      return res.status(504).json({ error: { message: '분해 분석 시간이 초과되었습니다. 재시도해 주세요.' } });
    }

    if (result.reason === 'http_429' || result.reason === 'http_503') {
      return res.status(503).json({ error: { message: 'AI 서비스가 일시적으로 바쁩니다. 잠시 후 다시 시도해 주세요.' } });
    }

    const elements = result.elements || [];
    let stashElements = [];
    let stashMeta;

    if (elements.length > 0) {
      if (!sources) {
        return res.status(400).json({
          error: {
            message:
              '원소가 추출되었습니다. 재료를 서버에서 소모하려면 클라이언트를 최신으로 새로고침한 뒤(slots 전송) 다시 시도해 주세요.',
          },
        });
      }

      try {
        stashElements = await prisma.$transaction(async (tx) => {
          await consumeMaterialSources(tx, req.user.id, names, sources);
          await incrementStashForElements(tx, req.user.id, elements);
          const rows = await tx.alchemyElementStock.findMany({
            where: { userId: req.user.id, count: { gt: 0 } },
            orderBy: [{ atomicNumber: 'asc' }, { symbol: 'asc' }],
          });
          return rows.map((r) => ({
            symbol: r.symbol,
            nameKo: r.nameKo,
            atomicNumber: r.atomicNumber,
            count: r.count,
          }));
        });
      } catch (err) {
        if (err && err.statusCode === 400) {
          return res.status(400).json({ error: { message: String(err.message || '요청이 올바르지 않습니다.') } });
        }
        if (isAlchemyStashUnavailableError(err)) {
          console.warn('[alchemy/decompose] stash persist skipped (migrate deploy?):', err.message);
          stashMeta = { stashUnavailable: true, stashPersistSkipped: true };
        } else {
          throw err;
        }
      }
    }

    const baseMeta = result.reason && elements.length === 0 ? { note: result.reason } : undefined;
    const meta =
      stashMeta || baseMeta
        ? { ...(baseMeta || {}), ...(stashMeta || {}) }
        : undefined;

    res.json({
      namesInput: names,
      elements,
      stashElements,
      meta,
    });
  } catch (err) {
    next(err);
  }
});

function coinValueForComposeRarity(rarity) {
  const r = String(rarity || 'common').toLowerCase();
  if (r === 'legendary') return 80;
  if (r === 'epic') return 40;
  return 18;
}

function sharedAlchemyCompoundCacheKey(name, rarity) {
  const r = String(rarity || 'common').trim().toLowerCase().slice(0, 20) || 'common';
  const n = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
  const base = `${SHARED_ALCHEMY_COMPOUND_PREFIX}${r}:`;
  const maxLen = Math.max(1, 100 - base.length);
  return `${base}${n.slice(0, maxLen)}`;
}

/**
 * POST /api/alchemy/compose — 추출 원소만 슬롯으로 조합 → AI 산출물 + 낚시 보관함(Catch, artifact) 1개
 */
router.post('/compose', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.slots) || body.slots.length < MIN_COMPOSE_SLOTS) {
      return res.status(400).json({
        error: { message: `조합은 추출 원소를 ${MIN_COMPOSE_SLOTS}개 이상 넣어 주세요.` },
      });
    }
    if (body.slots.length > MAX_COMPOSE_SLOTS) {
      return res.status(400).json({
        error: { message: `한 번에 최대 ${MAX_COMPOSE_SLOTS}슬롯까지 조합할 수 있습니다.` },
      });
    }

    const names = [];
    const sources = [];
    for (const slot of body.slots) {
      if (names.length >= MAX_COMPOSE_SLOTS) break;
      const nm = normLine(slot && slot.name != null ? slot.name : '');
      if (!nm) {
        return res.status(400).json({ error: { message: '슬롯 이름이 비어 있습니다.' } });
      }
      names.push(nm);
      sources.push(slot && slot.source && typeof slot.source === 'object' ? slot.source : {});
    }

    for (const src of sources) {
      const k = String(src.kind || '').toLowerCase();
      if (k !== 'alchemy_element') {
        return res.status(400).json({
          error: {
            message: '조합은 추출 원소만 가마솥에 넣을 수 있습니다. (낚시 재료·장비는 분해 전용)',
          },
        });
      }
    }

    const slotsForGemini = [];
    for (let i = 0; i < names.length; i += 1) {
      const src = sources[i];
      const sym = normalizeElementSymbol(src.symbol);
      if (!sym || !isValidElementSymbol(sym)) {
        return res.status(400).json({ error: { message: '유효하지 않은 원소 기호가 있습니다.' } });
      }
      if (!nameMatchesElementLine(names[i], sym)) {
        return res.status(400).json({ error: { message: '원소 이름과 기호가 맞지 않습니다.' } });
      }
      const qty = Math.max(1, Math.floor(Number(src.qty)) || 1);
      slotsForGemini.push({ name: names[i], symbol: sym, qty });
    }

    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), COMPOSE_TIMEOUT_MS);
    let ai;
    try {
      ai = await composeElementsToCompound(slotsForGemini, { signal: ac.signal });
    } finally {
      clearTimeout(tid);
    }

    if (!ai) {
      return res.status(503).json({ error: { message: 'AI 키가 설정되어 있지 않습니다.' } });
    }

    if (ai.reason) {
      if (ai.reason === 'timeout') {
        return res.status(504).json({ error: { message: '조합 분석 시간이 초과되었습니다.' } });
      }
      if (ai.reason === 'network') {
        return res.status(503).json({ error: { message: '네트워크 오류로 조합에 실패했습니다.' } });
      }
      if (ai.reason === 'need_two_elements') {
        return res.status(400).json({ error: { message: '유효한 원소가 두 종류 이상 필요합니다.' } });
      }
      const rs = String(ai.reason);
      if (rs.startsWith('http_429') || rs.startsWith('http_503')) {
        return res.status(503).json({ error: { message: 'AI 서비스가 일시적으로 바쁩니다.' } });
      }
      return res.status(503).json({ error: { message: '조합 결과를 만들지 못했습니다. 다시 시도해 주세요.' } });
    }

    const { compoundNameKo, itemEmoji, rarity, rationaleKo, formulaStyleKo, visualHintEn } = ai;
    const coinValue = Math.min(1000, coinValueForComposeRarity(rarity));
    const visualHintForLab =
      visualHintEn && String(visualHintEn).trim() ? String(visualHintEn).trim().slice(0, 220) : null;

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        await consumeMaterialSources(tx, req.user.id, names, sources);
        const pixelArtClean = generateCatchPixelArtFromFields({
          name: compoundNameKo,
          size: 0,
          rarity,
          type: 'artifact',
        });
        const created = await tx.catch.create({
          data: {
            userId: req.user.id,
            itemName: compoundNameKo,
            itemEmoji: itemEmoji.slice(0, 10),
            itemType: 'artifact',
            rarity,
            size: null,
            coinValue,
            sold: false,
            pixelArt: pixelArtClean,
          },
        });
        const u = await tx.user.update({
          where: { id: req.user.id },
          data: { lifetimeCatchCount: { increment: 1 } },
          select: { lifetimeCatchCount: true },
        });
        return { catch: created, lifetimeCatchTotal: u.lifetimeCatchCount };
      });
    } catch (err) {
      if (err && err.statusCode === 400) {
        return res.status(400).json({ error: { message: String(err.message || '요청이 올바르지 않습니다.') } });
      }
      throw err;
    }

    const cacheKey = sharedAlchemyCompoundCacheKey(compoundNameKo, rarity);
    try {
      const cached = await prisma.sharedPixelArt.findUnique({
        where: { name: cacheKey },
        select: { imageData: true },
      });
      if (cached && cached.imageData) {
        await prisma.catch.update({
          where: { id: result.catch.id },
          data: {
            pixelArt: {
              source: 'shared_cache',
              cacheKey,
              imageDataUrl: cached.imageData,
            },
          },
        });
      } else {
        const pixelAc = new AbortController();
        const pixelTimer = setTimeout(() => pixelAc.abort(), PIXELLAB_ALCHEMY_COMPOSE_MS);
        try {
          const png = await generateAlchemyCompoundPixelArt(
            compoundNameKo,
            rarity,
            pixelAc.signal,
            visualHintForLab,
          );
          if (png) {
            await prisma.catch.update({
              where: { id: result.catch.id },
              data: {
                pixelArt: {
                  source: 'pixellab',
                  imageDataUrl: png,
                },
              },
            });
            try {
              await prisma.sharedPixelArt.upsert({
                where: { name: cacheKey },
                create: {
                  name: cacheKey,
                  imageData: png,
                  rarity: String(rarity || 'common').slice(0, 20),
                  type: 'alchemy_compound',
                },
                update: {
                  imageData: png,
                  rarity: String(rarity || 'common').slice(0, 20),
                  type: 'alchemy_compound',
                },
              });
            } catch (e) {
              console.warn('[alchemy/compose] shared cache save skipped:', e && e.message ? e.message : e);
            }
          }
        } catch (e) {
          console.warn('[alchemy/compose] PixelLab sprite skipped:', e && e.message ? e.message : e);
        } finally {
          clearTimeout(pixelTimer);
        }
      }
    } catch (e) {
      console.warn('[alchemy/compose] shared cache / PixelLab skipped:', e && e.message ? e.message : e);
    }

    const freshRow = await prisma.catch.findUnique({ where: { id: result.catch.id } });
    let catchPayload = freshRow || result.catch;
    try {
      catchPayload = resolveCatchRowPixelArt(catchPayload);
    } catch (e) {
      /* ignore */
    }

    res.json({
      compound: {
        id: catchPayload.id,
        itemName: catchPayload.itemName,
        itemEmoji: catchPayload.itemEmoji,
        itemType: catchPayload.itemType,
        rarity: catchPayload.rarity,
        coinValue: catchPayload.coinValue,
        pixelArt: catchPayload.pixelArt,
      },
      rationaleKo,
      formulaStyleKo,
      lifetimeCatchTotal: result.lifetimeCatchTotal,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
