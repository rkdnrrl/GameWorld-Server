const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../services/auth');
const { prisma } = require('../db');

// Supabase 클라이언트 (소셜 로그인 토큰 검증용)
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

/**
 * 토큰 → user 객체 변환 (검증 실패 시 null 반환, throw 안 함)
 * 성공 시 req.user 와 동일한 구조 반환.
 */
async function resolveUserFromToken(token) {
  let userId, nickname, isOperator = false;

  // 1) 플랫폼 자체 JWT
  try {
    const decoded = verifyToken(token);
    userId     = decoded.sub;
    nickname   = decoded.nickname || decoded.name || `user_${userId.slice(0, 6)}`;
    isOperator = !!decoded.isOperator;
  } catch {
    // 2) Supabase 소셜 토큰 폴백
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) return null;
      const u = data.user;
      userId   = u.id;
      nickname = u.user_metadata?.full_name
        || u.user_metadata?.name
        || (u.email ? u.email.split('@')[0] : null)
        || `user_${userId.slice(0, 6)}`;
    } catch {
      return null;
    }
  }

  // 3) profiles 테이블 조회 / 자동 생성
  let profile = await prisma.profile.findUnique({ where: { id: userId } });
  if (!profile) {
    const base = String(nickname).slice(0, 28);
    const safeName = async (name) => {
      const exists = await prisma.profile.findFirst({ where: { username: name } });
      return exists ? `${name.slice(0, 24)}_${userId.slice(0, 4)}` : name;
    };
    profile = await prisma.profile.create({
      data: { id: userId, username: await safeName(base), isOperator: false },
    });
  }

  return {
    id:         profile.id,
    nickname:   profile.username,
    isOperator: profile.isOperator || isOperator,
  };
}

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const [type, token] = auth.split(' ');
    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ error: { message: '인증이 필요합니다.' } });
    }
    const user = await resolveUserFromToken(token);
    if (!user) return res.status(401).json({ error: { message: '유효하지 않은 토큰입니다.' } });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * 토큰이 있으면 검증해서 req.user 설정, 없거나 invalid 면 req.user = null.
 * 401 안 던짐 — "로그인했으면 추가 정보 보여줘" 같은 공개 라우트용.
 */
async function optionalAuth(req, _res, next) {
  try {
    const auth = req.headers.authorization || '';
    const [type, token] = auth.split(' ');
    if (type !== 'Bearer' || !token) { req.user = null; return next(); }
    req.user = await resolveUserFromToken(token);
    next();
  } catch (err) {
    // 에러도 조용히 — 인증 실패해도 페이지는 보여줘야 함
    req.user = null;
    next();
  }
}

module.exports = { requireAuth, optionalAuth };
