-- 범용 인벤토리 — 게임 간 자유 공유 아이템 저장소.
-- 기존 도메인 테이블 (catches, crafted_equipment 등) 은 그대로 두고 별도 운영.

CREATE TABLE "inventory_items" (
  "id"          BIGSERIAL PRIMARY KEY,
  "userId"      TEXT        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sourceGame"  VARCHAR(60) NOT NULL,
  "kind"        VARCHAR(80) NOT NULL,
  "category"    VARCHAR(40) NOT NULL,
  "name"        VARCHAR(120) NOT NULL,
  "icon"        VARCHAR(16),
  "tags"        TEXT[]      NOT NULL DEFAULT '{}',
  "stats"       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  "qty"         INTEGER     NOT NULL DEFAULT 1,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "inventory_items_userId_category_idx"   ON "inventory_items" ("userId", "category");
CREATE INDEX "inventory_items_userId_sourceGame_idx" ON "inventory_items" ("userId", "sourceGame");
CREATE INDEX "inventory_items_userId_kind_idx"       ON "inventory_items" ("userId", "kind");
