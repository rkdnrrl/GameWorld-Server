-- 게임별 내부 상태 저장소 — official 게임이 자유 JSON 데이터를 저장.
-- key: (userId, gameSlug). 한 유저-게임 조합당 1 row.

CREATE TABLE IF NOT EXISTS "game_state" (
  "userId"    TEXT        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "gameSlug"  VARCHAR(60) NOT NULL,
  "data"      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("userId", "gameSlug")
);

CREATE INDEX IF NOT EXISTS "game_state_gameSlug_idx" ON "game_state" ("gameSlug");
