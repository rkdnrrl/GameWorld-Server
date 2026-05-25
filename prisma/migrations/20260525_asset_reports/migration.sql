-- ────────────────────────────────────────────────────────────────────
-- Asset Reports (Phase 10) — 마켓플레이스 모더레이션
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_reports (
  id           TEXT        PRIMARY KEY,
  "assetId"    TEXT        NOT NULL,
  "reporterId" TEXT        NOT NULL,
  reason       TEXT        NOT NULL,                 -- 'inappropriate','copyright','spam','malware','other'
  comment      TEXT,                                 -- 자유 코멘트 (최대 500자)
  status       TEXT        NOT NULL DEFAULT 'pending', -- 'pending','dismissed','resolved'
  "resolvedBy" TEXT,                                 -- 운영자 userId
  "resolvedAt" TIMESTAMPTZ,
  "resolution" TEXT,                                 -- 'dismiss','hide','delete'
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT asset_reports_asset_fkey FOREIGN KEY ("assetId") REFERENCES assets(id) ON DELETE CASCADE
);

-- 같은 유저가 같은 에셋을 여러번 신고 못함
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_reports_user_asset
  ON asset_reports("reporterId", "assetId");

-- 운영자 큐 정렬
CREATE INDEX IF NOT EXISTS idx_asset_reports_status_created
  ON asset_reports(status, "createdAt" DESC);

-- assets 에 누적 신고수 (자동 hide 임계 판단용)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "reportCount" INTEGER NOT NULL DEFAULT 0;
