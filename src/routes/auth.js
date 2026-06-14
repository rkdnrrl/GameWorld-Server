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

/**
 * POST /api/auth/admin-signup — 이메일 인증 없는 즉시 가입.
 * 데스크톱 운영자 앱에서만 사용. Supabase service_role 로 email_confirm=true 설정 후 user 생성.
 *
 * 생성된 계정은 일반 사용자 — 데스크톱 콘솔 로그인 불가 (operator 권한 없음).
 * 기존 운영자가 /api/operators/promote 로 권한 부여 후 로그인 가능.
 *
 * body: { email, password, nickname? }
 */
router.post('/admin-signup', async (req, res, next) => {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_URL) {
      return res.status(500).json({ error: { message: 'SUPABASE_SERVICE_ROLE_KEY 환경변수 미설정.' } });
    }
    const { email, password, nickname } = req.body || {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: { message: '유효한 이메일이 필요합니다.' } });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: { message: '비밀번호는 최소 6자 이상이어야 합니다.' } });
    }
    const nick = (typeof nickname === 'string' && nickname.trim()) ? nickname.trim().slice(0, 30) : email.split('@')[0].slice(0, 30);

    const { createClient } = require('@supabase/supabase-js');
    let admin;
    const adminOpts = { auth: { autoRefreshToken: false, persistSession: false } };
    try {
      const ws = require('ws');
      admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        ...adminOpts, realtime: { transport: ws },
      });
    } catch {
      admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, adminOpts);
    }

    const { data, error } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,                            // ★ 이메일 인증 skip
      user_metadata: { nickname: nick },
    });

    if (error) {
      const msg = /already.*registered|already.*exist/i.test(error.message || '')
        ? '이미 가입된 이메일입니다.'
        : (error.message || '가입 실패');
      return res.status(400).json({ error: { message: msg } });
    }

    // Profile 도 미리 생성 (다른 운영자가 promote 할 때 username 으로 찾을 수 있게)
    try {
      const userId = data?.user?.id;
      if (userId) {
        // 묘비가 있으면 청소 (재가입 흐름)
        await prisma.deletedProfile.delete({ where: { id: userId } }).catch(() => {});
        // 같은 username 이 있으면 suffix
        const exists = await prisma.profile.findFirst({ where: { username: nick } });
        const finalUsername = exists ? `${nick.slice(0, 24)}_${userId.slice(0, 4)}` : nick;
        await prisma.profile.upsert({
          where: { id: userId },
          update: {},
          create: { id: userId, username: finalUsername, isOperator: false },
        });
      }
    } catch (e) {
      console.warn('[admin-signup] profile create failed:', e.message);
    }

    res.status(201).json({
      message: '가입 완료. 운영자가 권한을 부여하면 로그인할 수 있습니다.',
      userId: data?.user?.id,
      email: data?.user?.email,
      nickname: nick,
    });
  } catch (err) { next(err); }
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

/**
 * POST /api/auth/change-password — 비밀번호 변경.
 *   현재 비밀번호를 signInWithPassword 로 검증한 뒤, service-role admin 으로 즉시 변경한다.
 *   ⚠ 클라이언트 supabase.updateUser 는 (a) 클라에 세션이 없거나 (b) Supabase 'Secure password change'
 *     설정 시 이메일 확인 보류로, 성공만 뜨고 실제 변경이 안 되는 문제가 있어 서버에서 처리한다.
 */
const changePwSchema = z.object({
  email: z.string().email('이메일이 올바르지 않습니다.'),
  currentPassword: z.string().min(1, '현재 비밀번호를 입력해주세요.'),
  newPassword: z.string().min(8, '새 비밀번호는 8자 이상이어야 합니다.'),
});
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { email, currentPassword, newPassword } = changePwSchema.parse(req.body);
    const { createClient } = require('@supabase/supabase-js');
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const ANON = process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !ANON) {
      return res.status(500).json({ error: { message: '서버 설정이 누락되었습니다.' } });
    }
    // Node 20 은 native WebSocket 없음 → ws transport 명시 (services/auth.js·delete /me 와 동일 패턴)
    const mkClient = (key) => {
      const opts = { auth: { autoRefreshToken: false, persistSession: false } };
      try { const ws = require('ws'); return createClient(SUPABASE_URL, key, { ...opts, realtime: { transport: ws } }); }
      catch { return createClient(SUPABASE_URL, key, opts); }
    };

    // 1) 현재 비밀번호 검증 — 요청마다 새 anon 클라(세션 격리, 공유 싱글톤 레이스 방지)
    const anon = mkClient(ANON);
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password: currentPassword });
    if (signInErr || !signIn?.user) {
      return res.status(403).json({ error: { message: '현재 비밀번호가 올바르지 않습니다.' } });
    }
    // 인증된 본인 계정인지 확인 (남의 계정 변경 차단)
    if (signIn.user.id !== req.user.id) {
      return res.status(403).json({ error: { message: '본인 계정만 변경할 수 있습니다.' } });
    }

    // 2) 새 비밀번호 적용 — service-role admin(즉시 반영, 이메일 확인 불필요) 우선
    const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (SVC) {
      const admin = mkClient(SVC);
      const { error: updErr } = await admin.auth.admin.updateUserById(req.user.id, { password: newPassword });
      if (updErr) return res.status(400).json({ error: { message: updErr.message || '비밀번호 변경 실패' } });
    } else {
      // service role 없으면 검증에 쓴 anon 세션으로 updateUser (세션 격리됨). 이메일 확인 설정 시 보류될 수 있음.
      const { error: updErr } = await anon.auth.updateUser({ password: newPassword });
      if (updErr) return res.status(400).json({ error: { message: updErr.message || '비밀번호 변경 실패' } });
      console.warn('[change-password] SERVICE_ROLE_KEY 없음 — anon updateUser 사용(확인 설정 시 보류 가능)');
    }

    res.json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: { message: err.issues?.[0]?.message || '입력값이 올바르지 않습니다.' } });
    }
    next(err);
  }
});

// 현재 로그인한 사용자 정보. 게임 서버 등이 토큰을 검증할 때도 사용.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const profile = await prisma.profile.findUnique({
      where: { id: req.user.id },
      select: { id: true, username: true, createdAt: true, isOperator: true, alphaApproved: true, coins: true },
    });
    if (!profile) {
      return res.status(404).json({ error: { message: '사용자 정보를 찾을 수 없습니다.' } });
    }
    res.json({
      user: {
        id: profile.id,
        email: req.user.email || '',
        nickname: profile.username,
        coins: profile.coins ?? 0,
        createdAt: profile.createdAt,
        isOperator: !!profile.isOperator,
        operatorAccess: userIsOperator(profile),
        alphaApproved: !!profile.alphaApproved,
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
      select: { id: true, username: true, createdAt: true, isOperator: true, coins: true },
    });
    res.json({
      user: {
        id: updated.id,
        email: req.user.email || '',
        nickname: updated.username,
        coins: updated.coins ?? 0,
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
  // CLAUDE.md 의 테이블 목록 중 userId 컬럼 가진 것들.
  // 존재하지 않는 테이블은 42P01 로 silent skip 됨 — 추가/제거 자유.
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
  // 아래 3개는 실제 DB 에 없을 수 있음 (CLAUDE.md 에만 명시) — silent skip 됨
  // ['game_comments',           'userId'],
  // ['game_ratings',            'userId'],
  // ['game_reports',            'reporterId'],
];

router.delete('/me', requireAuth, async (req, res, next) => {
  const userId = req.user.id;
  const summary = { tables: {}, errors: [] };

  // 묘비 기록용 — Profile 삭제 전에 username 캡쳐
  const beforeProfile = await prisma.profile.findUnique({
    where: { id: userId }, select: { username: true },
  }).catch(() => null);

  try {
    // 1) 비-Prisma 테이블들 — 트랜잭션 밖에서 개별 처리 (테이블 없거나 컬럼 다르면 skip)
    // userId 컬럼이 UUID 타입이든 TEXT 타입이든 호환되게 양쪽 모두 text 로 캐스트.
    for (const [table, col] of USER_KEYED_TABLES) {
      try {
        const result = await prisma.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "${col}"::text = $1::text`, userId,
        );
        if (result > 0) summary.tables[table] = result;
      } catch (e) {
        // 테이블 없음 (42P01) / 컬럼 없음 (42703) → 무시. 그 외엔 로그.
        if (e?.code !== '42P01' && e?.code !== '42703') {
          // Prisma 가 e.code 안 채우는 경우 있으니 메시지로도 한 번 더 체크
          const msg = e?.message || '';
          if (!/does not exist/i.test(msg)) {
            summary.errors.push(`${table}: ${msg.slice(0, 200)}`);
            console.warn(`[delete /me] ${table}: ${msg}`);
          }
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

      // 한 번도 공개된 적 없는 월드만 명시 삭제 — 한 번이라도 공개됐던(wasPublic=true) 월드는
      // FK SetNull 로 자동 보존됨 (creatorId → NULL, 본체는 서버 귀속).
      const worldDel = await tx.world.deleteMany({
        where: { creatorId: userId, wasPublic: false },
      }).catch(() => ({ count: 0 }));
      if (worldDel?.count) summary.tables['worlds(private-only)'] = worldDel.count;

      // 공식 등록되지 않은 캐릭터만 명시 삭제 — isOfficial=true 캐릭터는
      // FK SetNull 로 자동 보존 (userId → NULL, 본체 서버 귀속).
      const charDel = await tx.character.deleteMany({
        where: { userId, isOfficial: false },
      }).catch(() => ({ count: 0 }));
      if (charDel?.count) summary.tables['characters(non-official)'] = charDel.count;

      // User row 삭제 (있으면)
      await tx.user.delete({ where: { id: userId } }).catch(() => {});

      // 3) Profile 삭제 — cascade 로 Character/ScriptComponent/Prefab/UserFollow/Notification/AssetLike/FolderPack 같이 사라짐.
      //    Asset 는 creatorId SetNull. World 는 SetNull (공식 보존) + 위에서 비공식은 이미 삭제됨.
      await tx.profile.delete({ where: { id: userId } });

      // 묘비 기록 — 다른 라우트의 upsert 가 다시 만드는 것 차단. 미들웨어에서 401.
      await tx.deletedProfile.upsert({
        where: { id: userId },
        create: {
          id: userId,
          originalUsername: beforeProfile?.username || null,
          email: req.user.email || null,
        },
        update: { deletedAt: new Date() },
      });
    });

    // 4) Supabase auth.users — service role 있을 때만
    let supabaseDeleted = false;
    if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        // Node 20 은 native WebSocket 없음 → ws 패키지 transport 명시 (services/auth.js 와 동일 패턴)
        let admin;
        const adminOpts = { auth: { autoRefreshToken: false, persistSession: false } };
        try {
          const ws = require('ws');
          admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
            ...adminOpts, realtime: { transport: ws },
          });
        } catch {
          admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, adminOpts);
        }
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) {
          summary.errors.push(`supabase auth.users: ${error.message}`);
          console.warn('[delete /me] supabase auth delete failed:', error.message);
        } else {
          supabaseDeleted = true;
        }
      } catch (e) {
        summary.errors.push(`supabase admin: ${e.message}`);
        console.warn('[delete /me] supabase admin init failed:', e.message);
      }
    }

    res.json({
      message: '회원 탈퇴가 완료되었습니다.',
      deletedTables: summary.tables,
      supabaseAuthDeleted: supabaseDeleted,
      warnings: summary.errors.length ? summary.errors : undefined,
      ...(!supabaseDeleted ? {
        note: (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL)
          ? 'Supabase auth.users 자동 삭제 실패 — warnings 메시지 확인.'
          : 'Supabase auth.users 는 자동 삭제 안 됨 — SUPABASE_SERVICE_ROLE_KEY 환경변수 추가 후 가능.',
      } : {}),
    });
  } catch (err) {
    console.error('[auth/me DELETE] failed:', err);
    next(err);
  }
});

/**
 * GET /api/auth/whoami — 토큰 → userId 만 반환 (경량).
 * alp-games-router 워커가 알림 WS 구독 시 토큰 검증을 이 라우트에 위임한다
 * (워커는 ALP/Supabase 두 토큰 형식을 직접 못 까므로). req.user 는 requireAuth 가 채움.
 */
router.get('/whoami', requireAuth, (req, res) => {
  res.json({ userId: req.user.id });
});

/**
 * GET /api/auth/profile — 내 프로필 조회
 * PATCH /api/auth/profile — bio / websiteUrl 수정
 */
router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.profile.findUnique({
      where: { id: req.user.id },
      select: {
        username: true, bio: true, profileImageUrl: true, websiteUrl: true,
        bannerUrl: true, iconEmoji: true, themeColor: true,
      },
    });
    res.json({
      profile: user
        ? {
            nickname: user.username,
            bio: user.bio,
            profileImageUrl: user.profileImageUrl,
            websiteUrl: user.websiteUrl,
            bannerUrl: user.bannerUrl,
            iconEmoji: user.iconEmoji,
            themeColor: user.themeColor,
          }
        : null,
    });
  } catch (err) { next(err); }
});

router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const { bio, websiteUrl, iconEmoji, themeColor, bannerUrl } = req.body;
    const data = {};
    if (typeof bio        === 'string') data.bio        = bio.trim().slice(0, 300);
    if (typeof websiteUrl === 'string') data.websiteUrl = websiteUrl.trim().slice(0, 200);
    if (typeof iconEmoji  === 'string') data.iconEmoji  = iconEmoji.trim().slice(0, 8) || null;
    if (typeof themeColor === 'string') {
      // hex 형식 검증
      data.themeColor = /^#[0-9a-f]{6}$/i.test(themeColor.trim()) ? themeColor.trim() : null;
    }
    if (typeof bannerUrl  === 'string') data.bannerUrl  = bannerUrl.trim().slice(0, 400) || null;
    const updated = await prisma.profile.update({
      where: { id: req.user.id },
      data,
      select: {
        username: true, bio: true, profileImageUrl: true, websiteUrl: true,
        bannerUrl: true, iconEmoji: true, themeColor: true,
      },
    });
    res.json({
      profile: {
        nickname: updated.username,
        bio: updated.bio,
        profileImageUrl: updated.profileImageUrl,
        websiteUrl: updated.websiteUrl,
        bannerUrl: updated.bannerUrl,
        iconEmoji: updated.iconEmoji,
        themeColor: updated.themeColor,
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
