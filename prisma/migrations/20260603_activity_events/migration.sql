-- 활동 피드 (Phase 18). 친구·팔로워가 볼 수 있는 사용자 활동 타임라인.
-- 일종의 SNS 타임라인: 자산 업로드/공개, 팔로우, 좋아요, 게시물, 친구 수락 등.

CREATE TABLE IF NOT EXISTS activity_events (
  id          TEXT PRIMARY KEY,
  "actorId"   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                  -- e.g. asset_published, world_created, friend_accepted, user_followed
  "targetId"  TEXT,                            -- target user / asset / world id (optional)
  payload     JSONB NOT NULL DEFAULT '{}',
  visibility  TEXT NOT NULL DEFAULT 'public', -- public / friends / followers
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_actor_created ON activity_events("actorId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_activity_created       ON activity_events("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_activity_type          ON activity_events(type);
