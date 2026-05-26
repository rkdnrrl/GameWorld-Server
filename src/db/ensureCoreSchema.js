const { prisma } = require('../db');

async function ensureCoreSchema() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "profiles" (
      id TEXT PRIMARY KEY,
      username VARCHAR(30) UNIQUE NOT NULL,
      "isOperator" BOOLEAN NOT NULL DEFAULT false,
      bio VARCHAR(300),
      "profileImageUrl" VARCHAR(400),
      "websiteUrl" VARCHAR(200),
      "followerCount" INTEGER NOT NULL DEFAULT 0,
      "followingCount" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "characters" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "userId" TEXT NOT NULL REFERENCES "profiles"(id) ON DELETE CASCADE,
      name VARCHAR(30) NOT NULL,
      appearance JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "characters"
    ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT false
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "characters"
    ADD COLUMN IF NOT EXISTS "is_public" BOOLEAN NOT NULL DEFAULT false
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "characters"
    ADD COLUMN IF NOT EXISTS "share_slug" TEXT
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "characters"
    DROP CONSTRAINT IF EXISTS "characters_userId_key"
  `);

  await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS "characters_userId_key"
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "characters_userId_is_active_idx"
    ON "characters" ("userId", "is_active")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "characters_one_active_per_user_idx"
    ON "characters" ("userId")
    WHERE "is_active" = true
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "characters_share_slug_key"
    ON "characters" ("share_slug")
    WHERE "share_slug" IS NOT NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "characters_is_public_updatedAt_idx"
    ON "characters" ("is_public", "updatedAt")
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "characters" c
    SET "is_active" = ranked.rn = 1
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY "userId"
          ORDER BY "is_active" DESC, "updatedAt" DESC, "createdAt" DESC, id DESC
        ) AS rn
      FROM "characters"
    ) ranked
    WHERE c.id = ranked.id
      AND NOT EXISTS (
        SELECT 1
        FROM "characters" active
        WHERE active."userId" = c."userId"
          AND active."is_active" = true
      )
  `);
}

module.exports = { ensureCoreSchema };
