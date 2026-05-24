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

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const [type, token] = auth.split(' ');
    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ error: { message: '인증이 필요합니다.' } });
    }

    let userId, nickname, isOperator = false;

    // 1) 플랫폼 자체 JWT 검증
    try {
      const decoded = verifyToken(token);
      userId     = decoded.sub;
      nickname   = decoded.nickname || decoded.name || `user_${userId.slice(0, 6)}`;
      isOperator = !!decoded.isOperator;
    } catch {
      // 2) Supabase 소셜 토큰 폴백
      if (!supabase) {
        return res.status(401).json({ error: { message: '유효하지 않은 토큰입니다.' } });
      }
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) {
        return res.status(401).json({ error: { message: '유효하지 않은 토큰입니다.' } });
      }
      const u = data.user;
      userId   = u.id;
      nickname = u.user_metadata?.full_name
        || u.user_metadata?.name
        || (u.email ? u.email.split('@')[0] : null)
        || `user_${userId.slice(0, 6)}`;
    }

    // 3) profiles 테이블 조회 / 자동 생성
    let profile = await prisma.profile.findUnique({ where: { id: userId } });

    if (!profile) {
      // 닉네임 중복 시 suffix 추가
      const base = String(nickname).slice(0, 28);
      const safeName = async (name) => {
        const exists = await prisma.profile.findFirst({ where: { username: name } });
        return exists ? `${name.slice(0, 24)}_${userId.slice(0, 4)}` : name;
      };
      profile = await prisma.profile.create({
        data: { id: userId, username: await safeName(base), isOperator: false },
      });
    }

    req.user = {
      id:         profile.id,
      nickname:   profile.username,
      isOperator: profile.isOperator || isOperator,
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
