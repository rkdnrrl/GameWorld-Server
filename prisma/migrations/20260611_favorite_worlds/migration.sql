-- 월드 즐겨찾기 (Phase 5-I) — 계정 단위 ★ 동기화
CREATE TABLE "favorite_worlds" (
  "user_id"       TEXT         NOT NULL,
  "world_id"      TEXT         NOT NULL,
  "name"          VARCHAR(120) NOT NULL,
  "thumbnail_url" VARCHAR(400),
  "added_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "favorite_worlds_pkey" PRIMARY KEY ("user_id", "world_id")
);

CREATE INDEX "favorite_worlds_user_id_added_at_idx"
  ON "favorite_worlds" ("user_id", "added_at" DESC);
