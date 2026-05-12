'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { decomposeMaterialNamesToElements } = require('../lib/geminiAlchemyDecompose');

const router = Router();

const MAX_NAMES = 16;
const MAX_NAME_LEN = 120;
const DECOMPOSE_TIMEOUT_MS = 18_000;

/**
 * POST /api/alchemy/decompose
 * body: { names: string[] } — 가마솥 재료 이름들; Gemini가 주기율표 원소로 분해 제안.
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

    res.json({
      namesInput: names,
      elements: result.elements || [],
      meta: result.reason && result.elements?.length === 0 ? { note: result.reason } : undefined,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
