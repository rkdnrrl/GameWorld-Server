-- 유저 정의 스크립트 컴포넌트 (Unity MonoBehaviour 비슷).
-- 부착하면 오브젝트에 그 동작 발현. 한 컴포넌트를 여러 오브젝트에 부착 가능.
-- Prisma camelCase 컬럼명 그대로 사용 (다른 테이블들과 일관성).

CREATE TABLE IF NOT EXISTS script_components (
  id            TEXT PRIMARY KEY,
  "creatorId"   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          VARCHAR(60) NOT NULL,
  icon          VARCHAR(8),
  description   VARCHAR(300),
  code          TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS script_components_creator_updated_idx
  ON script_components("creatorId", "updatedAt" DESC);
