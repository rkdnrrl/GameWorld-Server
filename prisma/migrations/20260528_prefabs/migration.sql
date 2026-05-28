-- 스튜디오 프리팹 (Unity 스타일) — 오브젝트 스냅샷 저장.
-- payload 예: { version: 1, root: { kind, position, rotation, scale, components, script, ... } }
--
-- 주의: Prisma 가 컬럼명을 camelCase 그대로 사용하므로 (다른 테이블들과 동일 convention)
-- SQL 에서도 camelCase 컬럼명을 그대로 씀.

CREATE TABLE IF NOT EXISTS prefabs (
  id            TEXT PRIMARY KEY,
  "creatorId"   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  "thumbnailUrl" VARCHAR(400),
  payload       JSONB NOT NULL,
  "isPublic"    BOOLEAN NOT NULL DEFAULT FALSE,
  "importCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS prefabs_creator_updated_idx ON prefabs("creatorId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS prefabs_public_imports_idx ON prefabs("isPublic", "importCount" DESC);
