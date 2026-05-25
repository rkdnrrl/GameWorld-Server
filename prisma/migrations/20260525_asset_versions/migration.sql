-- ────────────────────────────────────────────────────────────────────
-- Asset Versions (Phase 14) — 에셋 버전 히스토리
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_versions (
  id           TEXT        PRIMARY KEY,
  "assetId"    TEXT        NOT NULL,
  version      INTEGER     NOT NULL,                -- 1부터 시작, 순차 증가
  "modelUrl"   TEXT        NOT NULL,
  "thumbnailUrl" TEXT,
  "fileSize"   BIGINT,
  note         VARCHAR(300),                        -- 사용자 메모 ("머리 부분 수정")
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT asset_versions_asset_fkey FOREIGN KEY ("assetId") REFERENCES assets(id) ON DELETE CASCADE
);

-- 같은 에셋에 동일 버전 번호 금지
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_versions_asset_version
  ON asset_versions("assetId", version);

-- 시간순 조회
CREATE INDEX IF NOT EXISTS idx_asset_versions_asset_created
  ON asset_versions("assetId", "createdAt" DESC);

-- Asset 에 현재 버전 카운터 (auto-increment 용도 + 마켓에서 v 표시)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- 기존 에셋들에 대해 v1 백필 (현재 modelUrl/thumbnailUrl/fileSize 기준)
INSERT INTO asset_versions (id, "assetId", version, "modelUrl", "thumbnailUrl", "fileSize", note, "createdAt")
SELECT
  'v1_' || id,
  id,
  1,
  "modelUrl",
  "thumbnailUrl",
  "fileSize",
  NULL,
  "createdAt"
FROM assets
WHERE NOT EXISTS (SELECT 1 FROM asset_versions av WHERE av."assetId" = assets.id AND av.version = 1);
