-- ────────────────────────────────────────────────────────────────────
-- Folder Packs (Phase 15) — 폴더를 발행 단위로
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS folder_packs (
  id              TEXT        PRIMARY KEY,
  "creatorId"     TEXT        NOT NULL,
  path            TEXT        NOT NULL,                   -- "/캐릭터/주인공"
  "isPublic"      BOOLEAN     NOT NULL DEFAULT false,
  description     VARCHAR(500),
  "coverAssetId"  TEXT,                                   -- 대표 이미지 (asset id, nullable)
  "importCount"   INTEGER     NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT folder_packs_creator_fkey FOREIGN KEY ("creatorId") REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT folder_packs_cover_fkey   FOREIGN KEY ("coverAssetId") REFERENCES assets(id) ON DELETE SET NULL
);

-- 한 유저는 같은 path 에 대해 팩 하나만
CREATE UNIQUE INDEX IF NOT EXISTS uq_folder_packs_creator_path
  ON folder_packs("creatorId", path);

-- 마켓 (공개) 최신순
CREATE INDEX IF NOT EXISTS idx_folder_packs_public_created
  ON folder_packs("createdAt" DESC)
  WHERE "isPublic" = true;

-- 마켓 인기순
CREATE INDEX IF NOT EXISTS idx_folder_packs_public_popular
  ON folder_packs("importCount" DESC, "createdAt" DESC)
  WHERE "isPublic" = true;
