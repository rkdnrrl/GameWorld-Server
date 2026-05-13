const { verifyToken } = require('../services/auth');
const { prisma } = require('../db');

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const [type, token] = auth.split(' ');
    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ error: { message: '인증이 필요합니다.' } });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      return res.status(401).json({ error: { message: '유효하지 않은 토큰입니다.' } });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
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
