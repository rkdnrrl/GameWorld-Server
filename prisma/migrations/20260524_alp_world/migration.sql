-- ============================================================
-- ALP World — 완전 새 스키마
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 기존 테이블 전부 삭제 (역순)
DROP TABLE IF EXISTS ad_rewards           CASCADE;
DROP TABLE IF EXISTS social_messages      CASCADE;
DROP TABLE IF EXISTS community_comments   CASCADE;
DROP TABLE IF EXISTS community_posts      CASCADE;
DROP TABLE IF EXISTS game_state           CASCADE;
DROP TABLE IF EXISTS community_game_data  CASCADE;
DROP TABLE IF EXISTS game_reports         CASCADE;
DROP TABLE IF EXISTS game_ratings         CASCADE;
DROP TABLE IF EXISTS game_comments        CASCADE;
DROP TABLE IF EXISTS game_genres          CASCADE;
DROP TABLE IF EXISTS game_categories      CASCADE;
DROP TABLE IF EXISTS games                CASCADE;
DROP TABLE IF EXISTS inventory_items      CASCADE;
DROP TABLE IF EXISTS daily_mission_progress CASCADE;
DROP TABLE IF EXISTS donations            CASCADE;
DROP TABLE IF EXISTS alchemy_element_stock CASCADE;
DROP TABLE IF EXISTS modules              CASCADE;
DROP TABLE IF EXISTS enhancement_stock    CASCADE;
DROP TABLE IF EXISTS user_records         CASCADE;
DROP TABLE IF EXISTS announcements        CASCADE;
DROP TABLE IF EXISTS dungeon_saves        CASCADE;
DROP TABLE IF EXISTS smelt_stock          CASCADE;
DROP TABLE IF EXISTS crafted_equipment    CASCADE;
DROP TABLE IF EXISTS catches              CASCADE;
DROP TABLE IF EXISTS shared_pixel_arts    CASCADE;
DROP TABLE IF EXISTS furniture_items      CASCADE;
DROP TABLE IF EXISTS voxel_placements     CASCADE;
DROP TABLE IF EXISTS voxel_objects        CASCADE;
DROP TABLE IF EXISTS users                CASCADE;

-- ── 새 테이블 ──────────────────────────────────────────────

-- 유저 프로필
CREATE TABLE profiles (
  id          TEXT         PRIMARY KEY,   -- Supabase auth.users.id
  username    VARCHAR(30)  UNIQUE NOT NULL,
  "isOperator" BOOLEAN     NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 캐릭터 (유저당 1개)
CREATE TABLE characters (
  id          TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"    TEXT         NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  name        VARCHAR(30)  NOT NULL,
  appearance  JSONB        NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 월드/맵
CREATE TABLE worlds (
  id            TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "creatorId"   TEXT         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  description   VARCHAR(500),
  "thumbnailUrl" VARCHAR(400),
  "mapData"     JSONB        NOT NULL DEFAULT '{"objects":[]}',
  "isPublic"    BOOLEAN      NOT NULL DEFAULT false,
  "playCount"   INTEGER      NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX worlds_public_idx ON worlds("isPublic", "playCount" DESC);
CREATE INDEX worlds_creator_idx ON worlds("creatorId");

-- 에셋 (Meshy AI 생성 3D 모델)
CREATE TABLE assets (
  id            TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "creatorId"   TEXT         REFERENCES profiles(id) ON DELETE SET NULL,
  name          VARCHAR(100) NOT NULL,
  prompt        VARCHAR(500),
  "modelUrl"    VARCHAR(400) NOT NULL,
  "thumbnailUrl" VARCHAR(400),
  "meshyTaskId" VARCHAR(100),
  "polyCount"   INTEGER,
  "isPublic"    BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX assets_creator_idx ON assets("creatorId");
CREATE INDEX assets_public_idx  ON assets("isPublic");

-- updatedAt 자동 갱신 함수
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW."updatedAt" = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER characters_updated_at BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER worlds_updated_at     BEFORE UPDATE ON worlds     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
