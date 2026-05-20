const { Router } = require('express');
const { z } = require('zod');
const authService = require('../services/auth');
const { requireAuth } = require('../middleware/auth');
const { userIsOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');

const router = Router();

const signupSchema = z.object({
  email: z.string().email('올바른 이메일을 입력해주세요.'),
  nickname: z
    .string()
    .min(2, '닉네임은 2자 이상이어야 합니다.')
    .max(20, '닉네임은 20자 이하여야 합니다.'),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
  redirectTo: z.string().url().optional(),
});

const loginSchema = z.object({
  email: z.string().email('올바른 이메일을 입력해주세요.'),
  password: z.string().min(1, '비밀번호를 입력해주세요.'),
});

router.post('/signup', async (req, res, next) => {
  try {
    const data = signupSchema.parse(req.body);
    const result = await authService.signup(data);
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ZodError') {
      const message = err.issues?.[0]?.message || '입력값이 올바르지 않습니다.';
      return res.status(400).json({ error: { message } });
    }
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data);
    res.json(result);
  } catch (err) {
    if (err.name === 'ZodError') {
      const message = err.issues?.[0]?.message || '입력값이 올바르지 않습니다.';
      return res.status(400).json({ error: { message } });
    }
    next(err);
  }
});

/**
 * Supabase 토큰 → 플랫폼 JWT 교환 (7일 만료)
 * 소셜 로그인 후 호출하면 자체 JWT 발급 → 만료 관리 단순화
 */
router.post('/exchange', requireAuth, (req, res) => {
  // sub 는 platform DB users.id (= Supabase Auth user_id) 로 고정.
  // requireAuth 가 sub → prisma.user.findUnique({ id }) 로 조회하므로
  // 여기서 commonUserId 를 박으면 platform user 와 ID 가 어긋나 401 이 남.
  const token = authService.signToken(req.user.id, !!req.user.isOperator);
  res.json({ token });
});

// 현재 로그인한 사용자 정보. 게임 서버 등이 토큰을 검증할 때도 사용.
router.get('/me', requireAuth, async (req, res) => {
  const COMMON_API = 'https://api.airnuri.com';
  const cuid = req.user.commonUserId || req.user.id;
  try {
    const [coinRes, subRes] = await Promise.all([
      fetch(`${COMMON_API}/api/coins/${cuid}`).catch(() => null),
      fetch(`${COMMON_API}/api/subscriptions/${cuid}`).catch(() => null),
    ]);
    const coins = coinRes?.ok ? ((await coinRes.json()).coins ?? 0) : 0;
    let isSubscribed = false;
    let subscriptionUntil = null;
    if (subRes?.ok) {
      const s = await subRes.json();
      subscriptionUntil = s.until || s.expiresAt || null;
      isSubscribed = !!s.active || (subscriptionUntil && new Date(subscriptionUntil) > new Date());
    }
    res.json({ user: { ...req.user, coins, isSubscribed, subscriptionUntil, operatorAccess: userIsOperator(req.user) } });
  } catch {
    res.json({ user: { ...req.user, coins: 0, isSubscribed: false, operatorAccess: userIsOperator(req.user) } });
  }
});

// 닉네임 변경
const patchMeSchema = z.object({
  nickname: z
    .string()
    .min(2, '닉네임은 2자 이상이어야 합니다.')
    .max(20, '닉네임은 20자 이하여야 합니다.'),
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { nickname } = patchMeSchema.parse(req.body);

    const duplicate = await prisma.user.findFirst({
      where: { nickname, NOT: { id: req.user.id } },
      select: { id: true },
    });
    if (duplicate) {
      return res.status(409).json({ error: { message: '이미 사용 중인 닉네임입니다.' } });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { nickname },
      select: { id: true, nickname: true, createdAt: true, isOperator: true },
    });

    res.json({ user: { ...updated, operatorAccess: userIsOperator(updated) } });
  } catch (err) {
    if (err.name === 'ZodError') {
      const message = err.issues?.[0]?.message || '입력값이 올바르지 않습니다.';
      return res.status(400).json({ error: { message } });
    }
    next(err);
  }
});

// 회원 탈퇴
router.delete('/me', requireAuth, async (req, res, next) => {
  try {
    await prisma.user.delete({ where: { id: req.user.id } });
    res.json({ message: '회원 탈퇴가 완료되었습니다.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
