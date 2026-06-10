-- 최근 방문 월드 (Phase 5-K) — 계정 단위 LRU 동기화
CREATE TABLE "recent_worlds" (
  "user_id"       TEXT         NOT NULL,
  "world_id"      TEXT         NOT NULL,
  "name"          VARCHAR(120) NOT NULL,
  "thumbnail_url" VARCHAR(400),
  "visited_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recent_worlds_pkey" PRIMARY KEY ("user_id", "world_id")
);

CREATE INDEX "recent_worlds_user_id_visited_at_idx"
  ON "recent_worlds" ("user_id", "visited_at" DESC);
