-- ────────────────────────────────────────────────────────────────────
-- 알림 시스템 (Phase 12)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT        PRIMARY KEY,
  "userId"    TEXT        NOT NULL,                  -- 받는 사람
  type        TEXT        NOT NULL,                  -- 'asset_liked','user_followed','asset_imported','report_resolved','asset_auto_hidden'
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- 타입별 데이터 (assetId, actorName 등)
  "readAt"    TIMESTAMPTZ,                           -- NULL = 안 읽음
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notifications_user_fkey FOREIGN KEY ("userId") REFERENCES profiles(id) ON DELETE CASCADE
);

-- 내 알림 시간순
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications("userId", "createdAt" DESC);

-- 안 읽음 카운트 (벨 배지) — partial index 로 가볍게
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications("userId")
  WHERE "readAt" IS NULL;
