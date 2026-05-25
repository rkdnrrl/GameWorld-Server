-- ────────────────────────────────────────────────────────────────────
-- 유저 팔로우 (Phase 11)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_follows (
  "followerId" TEXT        NOT NULL,
  "followeeId" TEXT        NOT NULL,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("followerId", "followeeId"),
  CONSTRAINT user_follows_follower_fkey FOREIGN KEY ("followerId") REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT user_follows_followee_fkey FOREIGN KEY ("followeeId") REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT user_follows_no_self CHECK ("followerId" <> "followeeId")
);

CREATE INDEX IF NOT EXISTS idx_user_follows_followee ON user_follows("followeeId");
CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows("followerId");

-- 카운터 (denormalized — 핵심 페이지 매번 count 안 하려고)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS "followerCount"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS "followingCount" INTEGER NOT NULL DEFAULT 0;
