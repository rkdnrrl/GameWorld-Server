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
    CREATE TABLE IF NOT EXISTS "users" (
      id TEXT PRIMARY KEY,
      email VARCHAR(255),
      nickname VARCHAR(100),
      "isOperator" BOOLEAN NOT NULL DEFAULT false,
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
    CREATE TABLE IF NOT EXISTS "worlds" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "creatorId" TEXT NOT NULL REFERENCES "profiles"(id) ON DELETE CASCADE,
      name VARCHAR(50) NOT NULL,
      description TEXT,
      "thumbnailUrl" TEXT,
      "mapData" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "isPublic" BOOLEAN NOT NULL DEFAULT false,
      "playCount" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "asset_kinds" (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'box',
      extensions TEXT[] NOT NULL DEFAULT '{}',
      "mimeTypes" TEXT[] NOT NULL DEFAULT '{}',
      "maxSizeMb" INTEGER NOT NULL DEFAULT 100,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "assets" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "creatorId" TEXT NOT NULL REFERENCES "profiles"(id) ON DELETE CASCADE,
      name VARCHAR(80) NOT NULL,
      prompt TEXT,
      "modelUrl" TEXT NOT NULL,
      "thumbnailUrl" TEXT,
      "meshyTaskId" TEXT,
      "polyCount" INTEGER,
      "isPublic" BOOLEAN NOT NULL DEFAULT false,
      kind TEXT NOT NULL DEFAULT 'model',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      tags TEXT[] NOT NULL DEFAULT '{}',
      folder TEXT,
      "fileSize" BIGINT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "game_categories" (
      slug TEXT PRIMARY KEY,
      "labelKo" TEXT NOT NULL,
      "labelEn" TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🎮',
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "game_genres" (
      slug TEXT PRIMARY KEY,
      "labelKo" TEXT NOT NULL,
      "labelEn" TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🎮',
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "games" (
      slug TEXT PRIMARY KEY,
      "ownerUserId" TEXT REFERENCES "users"(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '🎮',
      kind TEXT NOT NULL DEFAULT 'community',
      status TEXT NOT NULL DEFAULT 'pending',
      category TEXT NOT NULL DEFAULT 'other',
      genre TEXT,
      "storagePath" TEXT NOT NULL DEFAULT '',
      "externalUrl" TEXT,
      "thumbnailUrl" TEXT,
      screenshots JSONB NOT NULL DEFAULT '[]'::jsonb,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      "statusUrl" TEXT,
      "maxPlayers" INTEGER NOT NULL DEFAULT 1,
      "playCount" INTEGER NOT NULL DEFAULT 0,
      "likeCount" INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      "rejectReason" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "publishedAt" TIMESTAMPTZ
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "announcements" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'notice',
      pinned BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "community_posts" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "userId" TEXT REFERENCES "users"(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'free',
      views INTEGER NOT NULL DEFAULT 0,
      "isPinned" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "community_comments" (
      id BIGSERIAL PRIMARY KEY,
      "postId" TEXT NOT NULL REFERENCES "community_posts"(id) ON DELETE CASCADE,
      "userId" TEXT REFERENCES "users"(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    ALTER TABLE "worlds"
    ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "assets"
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'model'
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "assets"
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "assets"
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "assets"
    ADD COLUMN IF NOT EXISTS folder TEXT
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "assets"
    ADD COLUMN IF NOT EXISTS "fileSize" BIGINT
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "games"
    ADD COLUMN IF NOT EXISTS genre TEXT
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "announcements"
    ALTER COLUMN id SET DEFAULT gen_random_uuid()::text
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "community_posts"
    ALTER COLUMN id SET DEFAULT gen_random_uuid()::text
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
    CREATE INDEX IF NOT EXISTS "worlds_isPublic_updatedAt_idx"
    ON "worlds" ("isPublic", "updatedAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "assets_creatorId_kind_createdAt_idx"
    ON "assets" ("creatorId", kind, "createdAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "games_status_kind_createdAt_idx"
    ON "games" (status, kind, "createdAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "announcements_pinned_createdAt_idx"
    ON "announcements" (pinned, "createdAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "community_posts_category_createdAt_idx"
    ON "community_posts" (category, "createdAt")
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
