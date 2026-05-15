const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('../services/auth');
const { prisma } = require('../db');

// Supabase 클라이언트 (토큰 검증용)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nickname: true,
        coins: true,
        smithingProficiency: true,
        createdAt: true,
        isOperator: true,
      },
    });
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
