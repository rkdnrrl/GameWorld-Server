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
router.post('/exchange', requireAuth, (req, res, next) => {
  try {
    const token = authService.signToken(req.user.id, !!req.user.isOperator);
    res.json({ token });
  } catch (err) {
    // Fallback: if platform JWT signing fails in runtime env,
    // return the original Supabase access token so login flow can continue.
    const auth = req.headers.authorization || '';
    const [type, rawToken] = auth.split(' ');
    if (type === 'Bearer' && rawToken) {
      console.error('[auth/exchange] signToken failed, fallback to supabase token:', err?.message || err);
      return res.json({ token: rawToken, fallback: true });
    }
    next(err);
  }
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
/**
 * DELETE /api/auth/me — 회원 탈퇴 (모든 데이터 완전 삭제).
 *
 * 삭제 순서:
 *   1. 비-Prisma 테이블 (catches, smelt_stock 등 게임 데이터) — userId 기반 raw SQL
 *   2. User 테이블 자식 (CommunityPost/Comment) + User 자체
 *   3. Profile (cascade 로 Character/World/ScriptComponent/Prefab/UserFollow/Notification 등 같이 삭제)
 *   4. Supabase auth.users — SUPABASE_SERVICE_ROLE_KEY 있을 때만 (없으면 이메일 재가입 차단됨 — 수동 정리 필요)
 *
 * 테이블 누락에 안전 — 존재하지 않는 테이블은 silent skip (개발/스테이징 환경 대비).
 */
const USER_KEYED_TABLES = [
  // CLAUDE.md 의 현재 테이블 목록 중 userId 컬럼 가진 것들
  ['catches',                 'userId'],
  ['crafted_equipment',       'userId'],
  ['dungeon_saves',           'userId'],
  ['enhancement_stock',       'userId'],
  ['smelt_stock',             'userId'],
  ['activity_logs',           'userId'],
  ['modules',                 'userId'],
  ['furniture_items',         'userId'],
  ['voxel_objects',           'userId'],
  ['voxel_placements',        'userId'],
  ['alchemy_element_stock',   'userId'],
  ['user_records',            'userId'],
  ['daily_mission_progress',  'userId'],
  ['ad_rewards',              'userId'],
  ['community_game_data',     'userId'],
  ['inventory_items',         'userId'],
  ['game_state',              'userId'],
  ['world_data',              'userId'],
  ['game_comments',           'userId'],
  ['game_ratings',            'userId'],
  ['game_reports',            'reporterId'],
];

router.delete('/me', requireAuth, async (req, res, next) => {
  const userId = req.user.id;
  const summary = { tables: {}, errors: [] };

  try {
    // 1) 비-Prisma 테이블들 — 트랜잭션 밖에서 개별 처리 (테이블 없거나 컬럼 다르면 skip)
    for (const [table, col] of USER_KEYED_TABLES) {
      try {
        const result = await prisma.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "${col}" = $1`, userId,
        );
        if (result > 0) summary.tables[table] = result;
      } catch (e) {
        // 테이블 없음 (42P01) / 컬럼 없음 (42703) → 무시. 그 외엔 로그.
        if (e?.code !== '42P01' && e?.code !== '42703') {
          summary.errors.push(`${table}: ${e.message}`);
          console.warn(`[delete /me] ${table}: ${e.message}`);
        }
      }
    }

    // 2) User 테이블 측 데이터 (community, games owner)
    await prisma.$transaction(async (tx) => {
      // CommunityComment / CommunityPost — User 의 자식. cascade 없어서 명시 삭제.
      await tx.communityComment.deleteMany({ where: { userId } }).catch(() => {});
      await tx.communityPost.deleteMany({ where: { userId } }).catch(() => {});
      // Game.ownerUserId — 사용자가 만든 UGC 게임은 ownerless 처리 (운영자가 검토 후 처리)
      // 영구 삭제하면 다른 유저들의 game_ratings/comments 도 사라져서 마켓 영향. nullify 가 안전.
      await tx.game.updateMany({ where: { ownerUserId: userId }, data: { ownerUserId: null } }).catch(() => {});

      // User row 삭제 (있으면)
      await tx.user.delete({ where: { id: userId } }).catch(() => {});

      // 3) Profile 삭제 — cascade 로 Character/World/ScriptComponent/Prefab/UserFollow/Notification/AssetLike/FolderPack 같이 사라짐.
      //    Asset 는 creatorId SetNull (다른 유저의 import/like 보존)
      await tx.profile.delete({ where: { id: userId } });
    });

    // 4) Supabase auth.users — service role 있을 때만
    let supabaseDeleted = false;
    if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) {
          summary.errors.push(`supabase auth.users: ${error.message}`);
          console.warn('[delete /me] supabase auth delete failed:', error.message);
        } else {
          supabaseDeleted = true;
        }
      } catch (e) {
        summary.errors.push(`supabase admin: ${e.message}`);
      }
    }

    res.json({
      message: '회원 탈퇴가 완료되었습니다.',
      deletedTables: summary.tables,
      supabaseAuthDeleted: supabaseDeleted,
      warnings: summary.errors.length ? summary.errors : undefined,
      ...(!supabaseDeleted ? { note: 'Supabase auth.users 는 자동 삭제 안 됨 — SUPABASE_SERVICE_ROLE_KEY 환경변수 추가 후 가능.' } : {}),
    });
  } catch (err) {
    console.error('[auth/me DELETE] failed:', err);
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
