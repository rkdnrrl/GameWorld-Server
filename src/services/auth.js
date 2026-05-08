const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { prisma } = require('../db');
const config = require('../config');

const SALT_ROUNDS = 12;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function signup({ email, nickname, password }) {
  const normalizedEmail = email.toLowerCase().trim();

  const exists = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { nickname }],
    },
    select: { email: true, nickname: true },
  });

  if (exists) {
    if (exists.email === normalizedEmail) {
      throw new HttpError(409, '이미 사용 중인 이메일입니다.');
    }
    throw new HttpError(409, '이미 사용 중인 닉네임입니다.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      nickname,
      passwordHash,
    },
    select: { id: true, email: true, nickname: true, createdAt: true },
  });

  const token = signToken(user.id);
  return { user, token };
}

async function login({ email, password }) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  const token = signToken(user.id);
  return {
    user: {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      createdAt: user.createdAt,
    },
    token,
  };
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

module.exports = { signup, login, signToken, verifyToken, HttpError };
