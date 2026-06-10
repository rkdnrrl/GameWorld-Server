-- 친구 위치 표시용 presence 테이블
-- heartbeat 30초마다 upsert, 90초 넘으면 offline 으로 판정.

CREATE TABLE IF NOT EXISTS "user_presence" (
  "user_id"    TEXT        PRIMARY KEY,
  "world_id"   TEXT        NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_user_presence_world"   ON "user_presence" ("world_id");
CREATE INDEX IF NOT EXISTS "idx_user_presence_updated" ON "user_presence" ("updated_at");
