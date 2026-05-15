-- ============================================================
-- GameWorld — 전체 테이블 생성 스크립트
-- Supabase SQL Editor에서 실행하세요.
-- ※ supabase-auth-setup.sql 보다 먼저 실행해야 합니다.
-- ============================================================

-- 1. users
CREATE TABLE IF NOT EXISTS "users" (
    "id"                  TEXT         NOT NULL,
    "email"               TEXT         NOT NULL,
    "nickname"            TEXT         NOT NULL,
    "passwordHash"        TEXT,
    "coins"               INTEGER      NOT NULL DEFAULT 0,
    "isOperator"          BOOLEAN      NOT NULL DEFAULT false,
    "lifetimeCatchCount"  INTEGER      NOT NULL DEFAULT 0,
    "smithingProficiency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key"    ON "users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_nickname_key" ON "users"("nickname");

-- 2. catches
CREATE TABLE IF NOT EXISTS "catches" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "itemName"  TEXT         NOT NULL,
    "itemEmoji" TEXT         NOT NULL DEFAULT '❓',
    "itemType"  TEXT         NOT NULL,
    "rarity"    TEXT         NOT NULL,
    "size"      DOUBLE PRECISION,
    "coinValue" INTEGER      NOT NULL,
    "pixelArt"  JSONB,
    "sold"      BOOLEAN      NOT NULL DEFAULT false,
    "soldAt"    TIMESTAMP(3),
    "caughtAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "catches_userId_idx"          ON "catches"("userId");
CREATE INDEX IF NOT EXISTS "catches_userId_caughtAt_idx" ON "catches"("userId", "caughtAt");
CREATE INDEX IF NOT EXISTS "catches_userId_sold_idx"     ON "catches"("userId", "sold");
ALTER TABLE "catches" DROP CONSTRAINT IF EXISTS "catches_userId_fkey";
ALTER TABLE "catches" ADD CONSTRAINT "catches_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. furniture_items
CREATE TABLE IF NOT EXISTS "furniture_items" (
    "id"          TEXT         NOT NULL,
    "userId"      TEXT         NOT NULL,
    "catId"       TEXT         NOT NULL,
    "placed"      BOOLEAN      NOT NULL DEFAULT false,
    "posX"        DOUBLE PRECISION,
    "posZ"        DOUBLE PRECISION,
    "rotY"        DOUBLE PRECISION,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placedAt"    TIMESTAMP(3),
    CONSTRAINT "furniture_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "furniture_items_userId_idx"        ON "furniture_items"("userId");
CREATE INDEX IF NOT EXISTS "furniture_items_userId_placed_idx" ON "furniture_items"("userId", "placed");
ALTER TABLE "furniture_items" DROP CONSTRAINT IF EXISTS "furniture_items_userId_fkey";
ALTER TABLE "furniture_items" ADD CONSTRAINT "furniture_items_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. voxel_objects
CREATE TABLE IF NOT EXISTS "voxel_objects" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "name"      VARCHAR(50)  NOT NULL,
    "price"     INTEGER      NOT NULL,
    "voxels"    JSONB        NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voxel_objects_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "voxel_objects_userId_idx" ON "voxel_objects"("userId");
ALTER TABLE "voxel_objects" DROP CONSTRAINT IF EXISTS "voxel_objects_userId_fkey";
ALTER TABLE "voxel_objects" ADD CONSTRAINT "voxel_objects_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. voxel_placements
CREATE TABLE IF NOT EXISTS "voxel_placements" (
    "id"            TEXT         NOT NULL,
    "userId"        TEXT         NOT NULL,
    "voxelObjectId" TEXT         NOT NULL,
    "posX"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posZ"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotY"          DOUBLE PRECISION NOT NULL DEFAULT 0,
    "placedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voxel_placements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "voxel_placements_userId_idx" ON "voxel_placements"("userId");
ALTER TABLE "voxel_placements" DROP CONSTRAINT IF EXISTS "voxel_placements_userId_fkey";
ALTER TABLE "voxel_placements" ADD CONSTRAINT "voxel_placements_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voxel_placements" DROP CONSTRAINT IF EXISTS "voxel_placements_voxelObjectId_fkey";
ALTER TABLE "voxel_placements" ADD CONSTRAINT "voxel_placements_voxelObjectId_fkey"
    FOREIGN KEY ("voxelObjectId") REFERENCES "voxel_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. shared_pixel_arts
CREATE TABLE IF NOT EXISTS "shared_pixel_arts" (
    "name"      VARCHAR(100) NOT NULL,
    "imageData" TEXT         NOT NULL,
    "rarity"    VARCHAR(20)  NOT NULL,
    "type"      VARCHAR(20)  NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shared_pixel_arts_pkey" PRIMARY KEY ("name")
);

-- 7. crafted_equipment
CREATE TABLE IF NOT EXISTS "crafted_equipment" (
    "id"             TEXT         NOT NULL,
    "userId"         TEXT         NOT NULL,
    "recipeId"       VARCHAR(64)  NOT NULL,
    "name"           VARCHAR(120) NOT NULL,
    "itemEmoji"      VARCHAR(16)  NOT NULL DEFAULT '⚔️',
    "tier"           VARCHAR(20)  NOT NULL DEFAULT 'common',
    "desc"           VARCHAR(400),
    "stats"          JSONB        NOT NULL,
    "sourceCatchIds" JSONB        NOT NULL,
    "pixelArt"       JSONB,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crafted_equipment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "crafted_equipment_userId_idx" ON "crafted_equipment"("userId");
ALTER TABLE "crafted_equipment" DROP CONSTRAINT IF EXISTS "crafted_equipment_userId_fkey";
ALTER TABLE "crafted_equipment" ADD CONSTRAINT "crafted_equipment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. smelt_stock
CREATE TABLE IF NOT EXISTS "smelt_stock" (
    "userId"    TEXT         NOT NULL,
    "productId" VARCHAR(32)  NOT NULL,
    "count"     INTEGER      NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "smelt_stock_pkey" PRIMARY KEY ("userId", "productId")
);
CREATE INDEX IF NOT EXISTS "smelt_stock_userId_idx" ON "smelt_stock"("userId");
ALTER TABLE "smelt_stock" DROP CONSTRAINT IF EXISTS "smelt_stock_userId_fkey";
ALTER TABLE "smelt_stock" ADD CONSTRAINT "smelt_stock_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. alchemy_element_stock
CREATE TABLE IF NOT EXISTS "alchemy_element_stock" (
    "userId"       TEXT         NOT NULL,
    "symbol"       VARCHAR(8)   NOT NULL,
    "nameKo"       VARCHAR(40),
    "atomicNumber" INTEGER,
    "count"        INTEGER      NOT NULL DEFAULT 0,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "alchemy_element_stock_pkey" PRIMARY KEY ("userId", "symbol")
);
CREATE INDEX IF NOT EXISTS "alchemy_element_stock_userId_idx" ON "alchemy_element_stock"("userId");
ALTER TABLE "alchemy_element_stock" DROP CONSTRAINT IF EXISTS "alchemy_element_stock_userId_fkey";
ALTER TABLE "alchemy_element_stock" ADD CONSTRAINT "alchemy_element_stock_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 10. activity_logs
CREATE TABLE IF NOT EXISTS "activity_logs" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "nickname"  VARCHAR(64)  NOT NULL,
    "action"    VARCHAR(32)  NOT NULL,
    "detail"    JSONB        NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "activity_logs_userId_idx"    ON "activity_logs"("userId");
CREATE INDEX IF NOT EXISTS "activity_logs_action_idx"    ON "activity_logs"("action");
CREATE INDEX IF NOT EXISTS "activity_logs_createdAt_idx" ON "activity_logs"("createdAt" DESC);

-- 11. dungeon_saves
CREATE TABLE IF NOT EXISTS "dungeon_saves" (
    "userId"  TEXT         NOT NULL,
    "data"    JSONB        NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dungeon_saves_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "dungeon_saves" DROP CONSTRAINT IF EXISTS "dungeon_saves_userId_fkey";
ALTER TABLE "dungeon_saves" ADD CONSTRAINT "dungeon_saves_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 12. enhancement_stock
CREATE TABLE IF NOT EXISTS "enhancement_stock" (
    "userId"    TEXT         NOT NULL,
    "itemType"  VARCHAR(32)  NOT NULL,
    "count"     INTEGER      NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "enhancement_stock_pkey" PRIMARY KEY ("userId", "itemType")
);
CREATE INDEX IF NOT EXISTS "enhancement_stock_userId_idx" ON "enhancement_stock"("userId");
ALTER TABLE "enhancement_stock" DROP CONSTRAINT IF EXISTS "enhancement_stock_userId_fkey";
ALTER TABLE "enhancement_stock" ADD CONSTRAINT "enhancement_stock_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 13. modules
CREATE TABLE IF NOT EXISTS "modules" (
    "id"            TEXT         NOT NULL,
    "userId"        TEXT         NOT NULL,
    "name"          VARCHAR(80)  NOT NULL,
    "moduleType"    VARCHAR(32)  NOT NULL,
    "tier"          VARCHAR(20)  NOT NULL DEFAULT 'common',
    "keywords"      JSONB        NOT NULL,
    "stats"         JSONB        NOT NULL,
    "durability"    INTEGER      NOT NULL DEFAULT 25,
    "durabilityMax" INTEGER      NOT NULL DEFAULT 25,
    "equippedTo"    VARCHAR(50),
    "equippedSlot"  VARCHAR(32),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "modules_userId_idx"     ON "modules"("userId");
CREATE INDEX IF NOT EXISTS "modules_equippedTo_idx" ON "modules"("equippedTo");
ALTER TABLE "modules" DROP CONSTRAINT IF EXISTS "modules_userId_fkey";
ALTER TABLE "modules" ADD CONSTRAINT "modules_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
