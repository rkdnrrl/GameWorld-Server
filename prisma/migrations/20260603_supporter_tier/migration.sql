-- 후원자 등급 (Phase 20). Supabase SQL Editor 에서 직접 실행.
-- 머그컵·토스 등 외부 후원 인증된 유저에게 운영자가 수동 부여.
-- tier: 'none' (기본) / 'bronze' / 'silver' / 'gold' / 'legend'

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS "supporterTier"  VARCHAR(20) NOT NULL DEFAULT 'none';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS "supporterSince" TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS "supporterNote"  VARCHAR(200);
CREATE INDEX IF NOT EXISTS idx_profiles_supporter ON profiles("supporterTier") WHERE "supporterTier" != 'none';
