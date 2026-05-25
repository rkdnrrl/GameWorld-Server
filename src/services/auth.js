const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

async function signup({ email, nickname, password, redirectTo }) {
  if (!supabase) throw new HttpError(500, 'Supabase 설정이 누락되었습니다.');

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { nickname },
      ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
    },
  });

  if (error) throw new HttpError(400, error.message || '회원가입 실패');

  if (!data?.session) {
    return {
      requiresEmailConfirmation: true,
      email,
      message: '인증 메일이 전송됐습니다. 메일을 확인한 뒤 로그인하세요.',
    };
  }

  return {
    requiresEmailConfirmation: false,
    email,
    message: '회원가입이 완료되었습니다.',
  };
}

async function login({ email, password }) {
  if (!supabase) throw new HttpError(500, 'Supabase 설정이 누락되었습니다.');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  return {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at || null,
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
