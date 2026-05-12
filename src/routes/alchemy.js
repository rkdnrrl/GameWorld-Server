'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { prisma } = require('../db');
const { decomposeMaterialNamesToElements } = require('../lib/geminiAlchemyDecompose');
const { normalizeElementSymbol, isValidElementSymbol } = require('../lib/periodicElementSymbols');

const router = Router();

const MAX_NAMES = 16;
const MAX_NAME_LEN = 120;
const DECOMPOSE_TIMEOUT_MS = 18_000;
const MAX_STASH_PER_SYMBOL = 999_999;

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

/**
 * POST /api/alchemy/decompose
 * body: { names: string[] } — 가마솥 재료 이름들; Gemini가 주기율표 원소로 분해 제안 후 **연금술 보관함**에 반영.
 */
router.post('/decompose', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const raw = body.names;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: { message: 'names 배열이 필요합니다.' } });
    }

    const names = [];
    for (const x of raw) {
      if (names.length >= MAX_NAMES) break;
      const s = String(x != null ? x : '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, MAX_NAME_LEN);
      if (s) names.push(s);
    }

    if (names.length === 0) {
      return res.status(400).json({ error: { message: '최소 한 개의 재료 이름이 필요합니다.' } });
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

    if (elements.length > 0) {
      stashElements = await prisma.$transaction(async (tx) => {
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
    }

    res.json({
      namesInput: names,
      elements,
      stashElements,
      meta: result.reason && elements.length === 0 ? { note: result.reason } : undefined,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
