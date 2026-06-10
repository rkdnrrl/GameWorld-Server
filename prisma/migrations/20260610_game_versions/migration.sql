-- 게임 버전 히스토리 — 운영자 승인 시 INSERT
CREATE TABLE "game_versions" (
  "id"            TEXT        PRIMARY KEY,
  "gameSlug"      TEXT        NOT NULL,
  "version"       INTEGER     NOT NULL,
  "storagePath"   TEXT        NOT NULL,
  "approvedById"  TEXT,
  "note"          VARCHAR(300),
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "game_versions_gameSlug_version_key" UNIQUE ("gameSlug", "version")
);

CREATE INDEX "game_versions_gameSlug_createdAt_idx" ON "game_versions" ("gameSlug", "createdAt");
