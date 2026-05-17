const jwt = require('jsonwebtoken');
const { prisma } = require('../db');
const config = require('../config');
const { userIsOperator } = require('../middleware/operatorAuth');

const COMMON_API = 'https://api.airliveplay.com';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function signup({ email, nickname, password }) {
  // Common API에 회원가입
  const res = await fetch(`${COMMON_API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, nickname, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new HttpError(res.status, data.error || '회원가입 실패');
  }

  const commonUserId = data.userId;

  // 플랫폼 DB에 게임 프로필 생성
  const isOperator = !!data.isOperator;

  const user = await prisma.user.create({
    data: { id: commonUserId, nickname },
    select: { id: true, nickname: true, createdAt: true },
  });

  const token = signToken(user.id, isOperator);
  return {
    user: { ...user, email, coins: 0, isOperator, operatorAccess: isOperator },
    token,
  };
}

async function login({ email, password }) {
  // Common API에 로그인
  const res = await fetch(`${COMMON_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new HttpError(401, data.error || '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  const { user: commonUser } = data;
  const commonUserId = commonUser.id;

  // 플랫폼 DB 프로필 조회 또는 생성
  let user = await prisma.user.findUnique({ where: { id: commonUserId } });
  if (!user) {
    user = await prisma.user.create({
      data: { id: commonUserId, nickname: commonUser.nickname },
    });
  }

  const isOperator = !!commonUser.isOperator;
  const token = signToken(user.id, isOperator);
  return {
    user: {
      id: user.id,
      email: commonUser.email,
      nickname: user.nickname,
      coins: commonUser.coins,
      createdAt: user.createdAt,
      isOperator,
      operatorAccess: isOperator,
    },
    token,
  };
}

function signToken(userId, isOperator = false) {
  return jwt.sign({ sub: userId, isOperator: !!isOperator }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

module.exports = { signup, login, signToken, verifyToken, HttpError };
