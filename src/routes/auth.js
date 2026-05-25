const { Router } = require('express');
const { z } = require('zod');
const multer = require('multer');
const authService = require('../services/auth');
const { requireAuth } = require('../middleware/auth');
const { userIsOperator } = require('../middleware/operatorAuth');
const { prisma } = require('../db');
const r2 = require('../lib/r2');

const CDN_BASE = 'https://play.airliveplay.com';
const IMG_MIME = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);
const MAX_PROFILE_IMG_BYTES = 5 * 1024 * 1024; // 5MB

const uploadProfileImg = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROFILE_IMG_BYTES, files: 1 },
});

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
  // requireAuth 가 sub → prisma.profile.findUnique({ id }) 로 조회하므로
  // 여기서 commonUserId 를 박으면 platform user 와 ID 가 어긋나 401 이 남.
  const token = authService.signToken(req.user.id, !!req.user.isOperator);
  res.json({ token });
});

// 현재 로그인한 사용자 정보. 게임 서버 등이 토큰을 검증할 때도 사용.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const profile = await prisma.profile.findUnique({
      where: { id: req.user.id },
      select: { id: true, username: true, createdAt: true, isOperator: true },
    });
    if (!profile) {
      return res.status(404).json({ error: { message: '사용자 정보를 찾을 수 없습니다.' } });
    }
    res.json({
      user: {
        id: profile.id,
        email: req.user.email || '',
        nickname: profile.username,
        coins: 0,
        createdAt: profile.createdAt,
        isOperator: !!profile.isOperator,
        operatorAccess: userIsOperator(profile),
        isSubscribed: false,
        subscriptionUntil: null,
      },
    });
  } catch {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email || '',
        nickname: req.user.nickname,
        coins: 0,
        createdAt: new Date().toISOString(),
        isOperator: !!req.user.isOperator,
        operatorAccess: userIsOperator(req.user),
        isSubscribed: false,
        subscriptionUntil: null,
      },
    });
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

    const duplicate = await prisma.profile.findFirst({
      where: { username: nickname, NOT: { id: req.user.id } },
      select: { id: true },
    });
    if (duplicate) {
      return res.status(409).json({ error: { message: '이미 사용 중인 닉네임입니다.' } });
    }

    const updated = await prisma.profile.update({
      where: { id: req.user.id },
      data: { username: nickname },
      select: { id: true, username: true, createdAt: true, isOperator: true },
    });
    res.json({
      user: {
        id: updated.id,
        email: req.user.email || '',
        nickname: updated.username,
        coins: 0,
        createdAt: updated.createdAt,
        isOperator: !!updated.isOperator,
        operatorAccess: userIsOperator(updated),
      },
    });
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
    await prisma.profile.delete({ where: { id: req.user.id } });
    res.json({ message: '회원 탈퇴가 완료되었습니다.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/profile — 내 프로필 조회
 * PATCH /api/auth/profile — bio / websiteUrl 수정
 */
router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.profile.findUnique({
      where: { id: req.user.id },
      select: { username: true, bio: true, profileImageUrl: true, websiteUrl: true },
    });
    res.json({
      profile: user
        ? {
            nickname: user.username,
            bio: user.bio,
            profileImageUrl: user.profileImageUrl,
            websiteUrl: user.websiteUrl,
          }
        : null,
    });
  } catch (err) { next(err); }
});

router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const { bio, websiteUrl } = req.body;
    const data = {};
    if (typeof bio        === 'string') data.bio        = bio.trim().slice(0, 300);
    if (typeof websiteUrl === 'string') data.websiteUrl = websiteUrl.trim().slice(0, 200);
    const updated = await prisma.profile.update({
      where: { id: req.user.id },
      data,
      select: { username: true, bio: true, profileImageUrl: true, websiteUrl: true },
    });
    res.json({
      profile: {
        nickname: updated.username,
        bio: updated.bio,
        profileImageUrl: updated.profileImageUrl,
        websiteUrl: updated.websiteUrl,
      },
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/auth/profile/image — 프로필 이미지 업로드 (즉시 반영)
 */
router.post('/profile/image', requireAuth, uploadProfileImg.single('profileImage'), async (req, res, next) => {
  try {
    const img = req.file;
    if (!img || !IMG_MIME.has(img.mimetype)) {
      return res.status(400).json({ error: { message: 'JPG/PNG/WebP 이미지를 첨부해주세요.' } });
    }
    if (img.size > MAX_PROFILE_IMG_BYTES) {
      return res.status(400).json({ error: { message: '이미지는 5MB 이하여야 합니다.' } });
    }
    const ext = IMG_MIME.get(img.mimetype);
    const key = `media/profiles/${req.user.id}.${ext}`;
    await r2.putObject(key, img.buffer, { contentType: img.mimetype });
    const profileImageUrl = `${CDN_BASE}/${key}`;
    await prisma.profile.update({
      where: { id: req.user.id },
      data: { profileImageUrl },
    });
    res.json({ ok: true, profileImageUrl });
  } catch (err) { next(err); }
});

module.exports = router;
