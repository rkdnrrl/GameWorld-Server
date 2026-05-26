-- Character sharing columns.
-- Supabase SQL Editor에서 직접 실행해야 운영 DB에 반영됩니다.

ALTER TABLE "characters"
ADD COLUMN IF NOT EXISTS "is_public" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "characters"
ADD COLUMN IF NOT EXISTS "share_slug" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "characters_share_slug_key"
ON "characters" ("share_slug")
WHERE "share_slug" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "characters_is_public_updatedAt_idx"
ON "characters" ("is_public", "updatedAt");
