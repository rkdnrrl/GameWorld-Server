const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../services/auth');
const { prisma } = require('../db');

// Supabase 클라이언트 (토큰 검증용)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    const ws = require('ws');
    supabase = createClient(supabaseUrl, supabaseKey, {
      realtime: { transport: ws },
    });
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

    let userId;

    // Supabase SDK로 토큰 검증 (SUPABASE_URL/ANON_KEY 설정된 경우)
    if (supabase) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) {
        return res.status(401).json({ error: { message: '유효하지 않은 토큰입니다.' } });
      }
      userId = data.user.id;
    } else {
      // 레거시: JWT_SECRET으로 직접 검증
      try {
        const decoded = verifyToken(token);
        userId = decoded.sub;
      } catch {
        return res.status(401).json({ error: { message: '유효하지 않은 토큰입니다.' } });
      }
    }

    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nickname: true,
        smithingProficiency: true,
        createdAt: true,
        isOperator: true,
        lifetimeCatchCount: true,
      },
    });

    // 소셜 로그인 신규 유저 자동 생성
    if (!user && supabase) {
      const { data: userData } = await supabase.auth.getUser(token);
      const supaUser = userData?.user;
      if (supaUser) {
        const email = supaUser.email || '';
        const rawNickname = supaUser.user_metadata?.full_name
          || supaUser.user_metadata?.name
          || email.split('@')[0]
          || `user_${userId.slice(0, 8)}`;
        // 닉네임 중복 방지
        let nickname = rawNickname.slice(0, 20);
        const exists = await prisma.user.findFirst({ where: { nickname } });
        if (exists) nickname = `${nickname.slice(0, 16)}_${userId.slice(0, 4)}`;

        user = await prisma.user.create({
          data: { id: userId, nickname },
          select: {
            id: true,
            nickname: true,
            smithingProficiency: true,
            createdAt: true,
            isOperator: true,
            lifetimeCatchCount: true,
          },
        });

        // Common API 유저 등록
        const { ensureCommonUser } = require('../lib/commonApi');
        ensureCommonUser(email, nickname).catch(() => {});
      }
    }

    if (!user) {
      return res.status(401).json({ error: { message: '존재하지 않는 사용자입니다.' } });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
