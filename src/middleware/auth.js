const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../services/auth');
const { prisma } = require('../db');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    const ws = require('ws');
    supabase = createClient(supabaseUrl, supabaseKey, { realtime: { transport: ws } });
  } catch (err) {
    console.warn('[auth] ws transport unavailable, falling back to default:', err?.message || err);
    supabase = createClient(supabaseUrl, supabaseKey);
  }
}

async function resolveUserFromToken(token) {
  let userId;
  let nickname;
  let isOperator = false;
  let email = '';

  try {
    const decoded = verifyToken(token);
    userId = decoded.sub;
    nickname = decoded.nickname || decoded.name || `user_${String(userId).slice(0, 6)}`;
    isOperator = !!decoded.isOperator;
  } catch {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return null;
      const u = data.user;
      email = u.email || '';
      userId = u.id;
      nickname =
        u.user_metadata?.nickname ||
        u.user_metadata?.full_name ||
        u.user_metadata?.name ||
        (u.email ? u.email.split('@')[0] : null) ||
        `user_${String(userId).slice(0, 6)}`;
    } catch (err) {
      console.warn('[auth] supabase getUser failed:', err?.message || err);
      return null;
    }
  }

  if (!userId) return null;

  // 묘비 체크 — DELETE /me 로 탈퇴한 직후 5분간만 거부 (zombie JWT 부활 차단).
  // 그 후엔 자동 해제 → 재가입·재로그인 정상 동작. 5분 = 옛 JWT 가 캐시될 수 있는 최소 시간.
  // (재로그인 시 발급되는 새 JWT 의 iat 가 묘비 후라면 통과 — 더 정확하지만 OAuth flow 에선 iat 검증 어려워서 시간 기반.)
  try {
    const tombstone = await prisma.deletedProfile.findUnique({ where: { id: userId } });
    if (tombstone) {
      const ageMs = Date.now() - new Date(tombstone.deletedAt).getTime();
      if (ageMs < 5 * 60 * 1000) {
        return { _deleted: true, id: userId };
      }
      // 5분 지남 → 묘비 자동 청소하고 통과 (재가입 흐름).
      await prisma.deletedProfile.delete({ where: { id: userId } }).catch((err) => {
        console.warn('[auth] tombstone cleanup failed:', err?.message || err);
      });
    }
  } catch (err) {
    // 마이그레이션 전엔 deletedProfile 테이블 없음 → 무시 OK. 그 외 에러는 가시화.
    if (err?.code !== 'P2021' /* table does not exist */) {
      console.warn('[auth] tombstone check failed:', err?.message || err);
    }
  }

  // Keep auth flow alive even when profile sync fails.
  try {
    let profile = await prisma.profile.findUnique({ where: { id: userId } });
    if (!profile) {
      const base = String(nickname).slice(0, 28);
      const exists = await prisma.profile.findFirst({ where: { username: base } });
      const username = exists ? `${base.slice(0, 24)}_${String(userId).slice(0, 4)}` : base;

      profile = await prisma.profile.create({
        data: { id: userId, username, isOperator: false },
      });
    }

    // 운영자 차단 체크 — bannedAt 있고 (banUntil 없거나 미래) 면 거부. 이미 로드된 profile 사용(추가 쿼리 X).
    if (profile.bannedAt && (!profile.banUntil || new Date(profile.banUntil).getTime() > Date.now())) {
      return { _banned: true, id: userId, reason: profile.banReason || null, until: profile.banUntil || null };
    }

    return {
      id: profile.id,
      nickname: profile.username,
      email,
      isOperator: profile.isOperator || isOperator,
    };
  } catch (err) {
    console.error('[auth] profile sync failed:', err?.message || err);
    return {
      id: userId,
      nickname: String(nickname || `user_${String(userId).slice(0, 6)}`),
      email,
      isOperator: !!isOperator,
    };
  }
}

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const [type, token] = auth.split(' ');
    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ error: { message: 'Authentication required.' } });
    }

    const user = await resolveUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: { message: 'Invalid token.' } });
    }
    if (user._deleted) {
      return res.status(401).json({ error: { message: '탈퇴한 계정입니다.', code: 'ACCOUNT_DELETED' } });
    }
    if (user._banned) {
      return res.status(403).json({
        error: {
          message: user.reason ? `이용이 제한된 계정입니다: ${user.reason}` : '이용이 제한된 계정입니다.',
          code: 'ACCOUNT_BANNED',
          until: user.until || null,
        },
      });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function optionalAuth(req, _res, next) {
  try {
    const auth = req.headers.authorization || '';
    const [type, token] = auth.split(' ');
    if (type !== 'Bearer' || !token) {
      req.user = null;
      return next();
    }

    const u = await resolveUserFromToken(token);
    req.user = (u && (u._deleted || u._banned)) ? null : u;
    next();
  } catch (err) {
    console.warn('[optionalAuth] resolve failed:', err?.message || err);
    req.user = null;
    next();
  }
}

module.exports = { requireAuth, optionalAuth };
