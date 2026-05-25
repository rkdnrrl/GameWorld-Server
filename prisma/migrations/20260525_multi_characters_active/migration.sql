-- Multi-character support:
-- 1) allow multiple rows per user in characters
-- 2) track active character with is_active flag (max 1 active per user)

ALTER TABLE "characters"
ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark newest character active for each user
WITH ranked AS (
  SELECT
    id,
    "userId",
    ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC) AS rn
  FROM "characters"
)
UPDATE "characters" c
SET "is_active" = (r.rn = 1)
FROM ranked r
WHERE c.id = r.id;

-- Remove old one-character-per-user unique constraint/index if present
ALTER TABLE "characters"
DROP CONSTRAINT IF EXISTS "characters_userId_key";
DROP INDEX IF EXISTS "characters_userId_key";

-- Query helper index
CREATE INDEX IF NOT EXISTS "characters_userId_is_active_idx"
ON "characters" ("userId", "is_active");

-- Enforce max one active character per user
DROP INDEX IF EXISTS "characters_one_active_per_user_idx";
CREATE UNIQUE INDEX "characters_one_active_per_user_idx"
ON "characters" ("userId")
WHERE "is_active" = true;
