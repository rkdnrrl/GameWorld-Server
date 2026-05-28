-- 스튜디오 프리팹 (Unity 스타일) — 오브젝트 스냅샷 저장.
-- payload 예: { version: 1, root: { kind, position, rotation, scale, components, script, ... } }
CREATE TABLE IF NOT EXISTS prefabs (
  id            TEXT PRIMARY KEY,
  creator_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  thumbnail_url VARCHAR(400),
  payload       JSONB NOT NULL,
  is_public     BOOLEAN NOT NULL DEFAULT FALSE,
  import_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS prefabs_creator_updated_idx ON prefabs(creator_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS prefabs_public_imports_idx ON prefabs(is_public, import_count DESC);
