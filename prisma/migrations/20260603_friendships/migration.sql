-- 친구 관계 (Phase 16). Supabase SQL Editor 에서 직접 실행.

-- 1. friendships 테이블
CREATE TABLE IF NOT EXISTS friendships (
  id            TEXT PRIMARY KEY,
  "requesterId" TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  "receiverId"  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "respondedAt" TIMESTAMPTZ,
  CONSTRAINT friendships_requester_receiver_unique UNIQUE ("requesterId", "receiverId"),
  CONSTRAINT friendships_no_self CHECK ("requesterId" != "receiverId"),
  CONSTRAINT friendships_status_valid CHECK (status IN ('pending', 'accepted', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships("requesterId");
CREATE INDEX IF NOT EXISTS idx_friendships_receiver  ON friendships("receiverId");
CREATE INDEX IF NOT EXISTS idx_friendships_status    ON friendships(status);

-- 2. profiles 에 친구 카운터 (denormalized)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS "friendCount" INTEGER NOT NULL DEFAULT 0;
