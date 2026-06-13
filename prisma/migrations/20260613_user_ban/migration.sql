-- 운영자 유저 차단(ban) 필드. Supabase SQL Editor 에서 직접 실행.
-- bannedAt 있으면 차단(로그인/API 거부). banUntil = 정지 만료 시각(null = 영구). banReason = 사유.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS "bannedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "banReason" VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "banUntil"  TIMESTAMP(3);
