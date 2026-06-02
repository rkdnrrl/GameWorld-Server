-- 프로필 꾸미기 (Phase 17). Supabase SQL Editor 에서 직접 실행.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS "bannerUrl"  VARCHAR(400);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS "iconEmoji"  VARCHAR(8);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS "themeColor" VARCHAR(20);  -- e.g. "#6366f1"
