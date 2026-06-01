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
  } catch {
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
    } catch {
      return null;
    }
  }

  if (!userId) return null;

  // 묘비 체크 — DELETE /me 로 탈퇴한 계정이면 즉시 거부 (auto-upsert 부활 차단).
  // 운영자가 deleted_profiles 에서 row 지우면 재가입 가능.
  try {
    const tombstone = await prisma.deletedProfile.findUnique({ where: { id: userId } });
    if (tombstone) return { _deleted: true, id: userId };
  } catch { /* 마이그레이션 전엔 테이블 없음 — skip */ }

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
    req.user = (u && u._deleted) ? null : u;
    next();
  } catch {
    req.user = null;
    next();
  }
}

module.exports = { requireAuth, optionalAuth };
