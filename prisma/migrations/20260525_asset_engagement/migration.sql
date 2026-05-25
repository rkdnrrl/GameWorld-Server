-- ────────────────────────────────────────────────────────────────────
-- Asset Engagement (Phase 8)
-- 좋아요 + 가져오기 카운트 → 마켓플레이스 인기순 정렬
-- ────────────────────────────────────────────────────────────────────

-- 1) 카운터 컬럼
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "likeCount"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "importCount" INTEGER NOT NULL DEFAULT 0;

-- 2) 좋아요 테이블 (유저↔에셋 N:M)
CREATE TABLE IF NOT EXISTS asset_likes (
  "userId"    TEXT NOT NULL,
  "assetId"   TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("userId", "assetId"),
  CONSTRAINT asset_likes_asset_fkey FOREIGN KEY ("assetId") REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_likes_user   ON asset_likes("userId");
CREATE INDEX IF NOT EXISTS idx_asset_likes_asset  ON asset_likes("assetId");

-- 3) 인기순 정렬용 복합 인덱스 (공개 에셋만)
CREATE INDEX IF NOT EXISTS idx_assets_public_popular
  ON assets("likeCount" DESC, "importCount" DESC, "createdAt" DESC)
  WHERE "isPublic" = true;
