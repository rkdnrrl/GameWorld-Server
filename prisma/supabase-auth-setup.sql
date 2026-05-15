-- ============================================================
-- Supabase Auth 연동 설정 SQL
-- Supabase 대시보드 → SQL Editor 에서 순서대로 실행하세요.
-- ============================================================


-- ── 1. passwordHash nullable 변경 ───────────────────────────
-- Supabase가 비밀번호를 직접 관리하므로 서버 측 hash 불필요.
-- 기존 자체 회원가입 유저는 이미 hash 값이 있어 영향 없음.

ALTER TABLE users ALTER COLUMN "passwordHash" DROP NOT NULL;


-- ── 2. 닉네임 중복 방지 헬퍼 ────────────────────────────────
-- 동일 닉네임이 이미 있으면 suffix 숫자를 붙여 유니크하게 만듦.
-- 예: "홍길동" → "홍길동1" → "홍길동2" …

CREATE OR REPLACE FUNCTION public.generate_unique_nickname(base_nick TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  candidate TEXT;
  suffix    INT := 0;
BEGIN
  -- 최대 20자 (Prisma max 기준)
  candidate := LEFT(base_nick, 20);
  WHILE EXISTS (SELECT 1 FROM public.users WHERE nickname = candidate) LOOP
    suffix    := suffix + 1;
    candidate := LEFT(base_nick, 20 - LENGTH(suffix::text)) || suffix::text;
  END LOOP;
  RETURN candidate;
END;
$$;


-- ── 3. auth.users 삽입 트리거 함수 ──────────────────────────
-- Supabase Auth에서 새 유저가 생성되면 public.users 행을 자동 생성.
--
-- 닉네임 우선순위:
--   1) signUp() 호출 시 options.data.nickname 으로 전달한 값
--   2) 이메일 @ 앞부분 (fallback)
--
-- 프론트에서 signUp 호출 예시 (supabase-js):
--   supabase.auth.signUp({
--     email, password,
--     options: { data: { nickname: '플레이어이름' } }
--   })

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  raw_nick   TEXT;
  final_nick TEXT;
BEGIN
  -- 닉네임 결정
  raw_nick := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'nickname'), ''),
    split_part(NEW.email, '@', 1)
  );

  -- 특수문자 제거 (영문·한글·숫자·_·- 만 허용)
  raw_nick := REGEXP_REPLACE(raw_nick, '[^\w가-힣\-]', '', 'g');
  -- 빈 문자열이면 'user' 사용
  IF raw_nick = '' THEN raw_nick := 'user'; END IF;

  -- 중복 없는 닉네임 생성
  final_nick := public.generate_unique_nickname(raw_nick);

  INSERT INTO public.users (
    id,
    email,
    nickname,
    "passwordHash",
    coins,
    "isOperator",
    "lifetimeCatchCount",
    "smithingProficiency",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    NEW.id::text,      -- Supabase UUID를 그대로 사용
    NEW.email,
    final_nick,
    NULL,              -- Supabase가 비밀번호 관리
    0,
    false,
    0,
    0.0,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;  -- 중복 삽입 방지 (재실행 안전)

  RETURN NEW;
END;
$$;


-- ── 4. 트리거 등록 ───────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();


-- ── 5. (선택) 이메일 변경 시 public.users 동기화 ────────────
-- Supabase에서 이메일을 변경하면 auth.users.email이 업데이트됨.
-- public.users.email도 함께 동기화하려면 아래 트리거를 추가.

CREATE OR REPLACE FUNCTION public.handle_auth_user_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET    email     = NEW.email,
         "updatedAt" = NOW()
  WHERE  id = NEW.id::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_update();


-- ── 6. (선택) Supabase RLS 비활성화 ─────────────────────────
-- 이 프로젝트는 Express 서버를 통해서만 DB 접근하므로 RLS가
-- 필요 없을 수 있습니다. 현재 RLS가 켜져 있다면 아래를 실행:
--
-- ALTER TABLE users DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE catches DISABLE ROW LEVEL SECURITY;
-- (나머지 테이블도 동일하게)
--
-- ※ Supabase 대시보드 Table Editor에서도 끌 수 있습니다.


-- ============================================================
-- 완료 후 서버 측 추가 작업:
--
-- 1. GameWorld-Server/.env 에 추가:
--      SUPABASE_JWT_SECRET=<Settings → API → JWT Secret>
--
-- 2. src/config/index.js 의 required 배열에서
--    'JWT_SECRET' 을 'SUPABASE_JWT_SECRET' 으로 교체 (또는 병기)
--
-- 3. src/services/auth.js 의 verifyToken() 에서
--    config.jwt.secret → process.env.SUPABASE_JWT_SECRET 으로 변경
--    (Supabase JWT는 HS256, sub 필드 = auth.users.id = public.users.id)
-- ============================================================
