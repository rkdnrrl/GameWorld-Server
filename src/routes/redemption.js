/**
 * Redemption codes — 외부 결제 (텀블벅 등) 후원자에게 발급하는 1회용 코드.
 *
 * 운영자:
 *   POST   /api/operator/redemption-codes        — 일괄 생성 { tier, count, batchLabel?, expiresAt? }
 *   GET    /api/operator/redemption-codes        — 목록 (필터: ?tier, ?batchLabel, ?status=unused|used|revoked)
 *   PATCH  /api/operator/redemption-codes/:id    — 무효화/해제 { revoked: true|false }
 *
 * 유저:
 *   POST   /api/redemption/redeem                — 코드 입력 { code } → tier 부여
 */
const { Router } = require('express');
const { prisma } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireOperator } = require('../middleware/operatorAuth');

const router = Router();
const operatorRouter = Router();

// 'alpha' = 오픈 알파 접속 코드 (supporter tier 아님 → redeem 시 profile.alphaApproved=true).
const VALID_TIERS = ['bronze', 'silver', 'gold', 'legend', 'alpha'];
const TIER_ORDER = { legend: 4, gold: 3, silver: 2, bronze: 1, none: 0 };

/** 가독성 좋은 8자 코드 — 헷갈리는 문자 (0/O/1/I/L) 제외 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateCode() {
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  // 4-4 형식 (가독성)
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/* ─────────────────────────────────────────
   유저: 코드 사용 — POST /api/redemption/redeem
───────────────────────────────────────── */
router.post('/redeem', requireAuth, async (req, res, next) => {
  try {
    const raw = String(req.body?.code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!raw) return res.status(400).json({ error: { code: 'EMPTY', message: '코드를 입력해주세요.' } });

    const code = await prisma.redemptionCode.findUnique({ where: { code: raw } });
    if (!code)              return res.status(404).json({ error: { code: 'NOT_FOUND', message: '존재하지 않는 코드입니다.' } });
    if (code.revoked)       return res.status(410).json({ error: { code: 'REVOKED', message: '무효화된 코드입니다.' } });
    if (code.usedByUserId)  return res.status(409).json({ error: { code: 'ALREADY_USED', message: '이미 사용된 코드입니다.' } });
    if (code.expiresAt && new Date() > code.expiresAt) {
      return res.status(410).json({ error: { code: 'EXPIRED', message: '만료된 코드입니다.' } });
    }

    // Profile 조회 + tier upgrade (현재 tier 보다 높을 때만 변경 — downgrade 방지)
    const profile = await prisma.profile.findUnique({ where: { id: req.user.id } });
    if (!profile) return res.status(404).json({ error: { code: 'NO_PROFILE', message: '프로필이 없습니다.' } });

    // 'alpha' 코드 = 오픈 알파 접속 승인 (supporter tier 아님). 그 외 = supporter tier 업그레이드.
    const isAlpha = code.tier === 'alpha';
    const currentRank = TIER_ORDER[profile.supporterTier] || 0;
    const newRank     = TIER_ORDER[code.tier] || 0;
    const shouldUpgrade = !isAlpha && newRank > currentRank;

    // 트랜잭션 — 코드 사용 마킹 + (필요 시) profile 업데이트
    const result = await prisma.$transaction(async (tx) => {
      // 코드 사용 처리 — race condition 방지 위해 unused 상태일 때만 update
      const upd = await tx.redemptionCode.updateMany({
        where: { id: code.id, usedByUserId: null },
        data:  { usedByUserId: req.user.id, usedAt: new Date() },
      });
      if (upd.count !== 1) {
        // 동시에 다른 요청이 먼저 사용
        throw Object.assign(new Error('race'), { httpCode: 409, errCode: 'ALREADY_USED' });
      }
      let updatedProfile = profile;
      if (isAlpha) {
        updatedProfile = await tx.profile.update({
          where: { id: req.user.id },
          data: { alphaApproved: true },
          select: { id: true, username: true, alphaApproved: true },
        });
      } else if (shouldUpgrade) {
        updatedProfile = await tx.profile.update({
          where: { id: req.user.id },
          data: {
            supporterTier: code.tier,
            supporterSince: profile.supporterSince || new Date(),
          },
          select: { id: true, username: true, supporterTier: true, supporterSince: true },
        });
      }
      return { tier: code.tier, alpha: isAlpha, upgraded: shouldUpgrade || isAlpha, profile: updatedProfile };
    });

    res.json(result);
  } catch (err) {
    if (err.httpCode) {
      return res.status(err.httpCode).json({ error: { code: err.errCode, message: err.message } });
    }
    next(err);
  }
});

/* ─────────────────────────────────────────
   운영자: 일괄 생성 — POST /api/operator/redemption-codes
   body: { tier, count, batchLabel?, expiresAt? (ISO) }
───────────────────────────────────────── */
operatorRouter.post('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { tier, count, batchLabel, expiresAt } = req.body || {};
    if (!VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'invalid tier' });
    const n = Math.max(1, Math.min(1000, parseInt(count) || 0));
    if (!n) return res.status(400).json({ error: 'count must be 1~1000' });

    const labelClean = typeof batchLabel === 'string' ? batchLabel.slice(0, 100) : null;
    const expDate    = expiresAt ? new Date(expiresAt) : null;
    if (expDate && isNaN(expDate.getTime())) return res.status(400).json({ error: 'invalid expiresAt' });

    // 코드 생성 (충돌 발생 시 retry — 31^8 = 8.5e11 이라 실용상 거의 없음)
    const rows = [];
    const seen = new Set();
    while (rows.length < n) {
      const code = generateCode();
      if (seen.has(code)) continue;
      seen.add(code);
      rows.push({ code, tier, batchLabel: labelClean, expiresAt: expDate });
    }
    await prisma.redemptionCode.createMany({ data: rows, skipDuplicates: true });
    // createMany 결과 fetch
    const created = await prisma.redemptionCode.findMany({
      where: { code: { in: rows.map(r => r.code) } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ created: created.length, codes: created });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   운영자: 목록 — GET /api/operator/redemption-codes
   query: ?tier=bronze&batchLabel=텀블벅1차&status=unused|used|revoked
───────────────────────────────────────── */
operatorRouter.get('/', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { tier, batchLabel, status } = req.query;
    const where = {};
    if (tier && VALID_TIERS.includes(tier)) where.tier = tier;
    if (batchLabel) where.batchLabel = String(batchLabel).slice(0, 100);
    if (status === 'unused')  where.AND = [{ usedByUserId: null }, { revoked: false }];
    if (status === 'used')    where.usedByUserId = { not: null };
    if (status === 'revoked') where.revoked = true;

    const codes = await prisma.redemptionCode.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    // 통계 — 운영자 페이지 헤더용
    const stats = await prisma.redemptionCode.groupBy({
      by: ['tier'],
      _count: { _all: true },
      where: { usedByUserId: null, revoked: false },
    });
    res.json({ codes, unusedByTier: stats });
  } catch (err) { next(err); }
});

/* ─────────────────────────────────────────
   운영자: 무효화/복구 — PATCH /api/operator/redemption-codes/:id
   body: { revoked: true | false }
───────────────────────────────────────── */
operatorRouter.patch('/:id', requireAuth, requireOperator, async (req, res, next) => {
  try {
    const { revoked } = req.body || {};
    if (typeof revoked !== 'boolean') return res.status(400).json({ error: 'revoked must be boolean' });
    const code = await prisma.redemptionCode.findUnique({ where: { id: req.params.id } });
    if (!code) return res.status(404).json({ error: 'not found' });
    const updated = await prisma.redemptionCode.update({
      where: { id: req.params.id },
      data:  { revoked },
    });
    res.json({ code: updated });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.operatorRouter = operatorRouter;
