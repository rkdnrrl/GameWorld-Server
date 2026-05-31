-- 맵별 영구 데이터 (KV) — 스크립트 data.save/load/list 가 사용.
-- userId NULL = 맵 전역 (모두 공유), userId 있음 = 플레이어 개인.
-- (mapId, userId, key) unique 로 upsert. userId NULL upsert 호환을 위해 일반 unique 인덱스 사용.
CREATE TABLE IF NOT EXISTS world_data (
  id          TEXT PRIMARY KEY,
  "mapId"     VARCHAR(40)  NOT NULL,
  "userId"    VARCHAR(40),           -- NULL = 맵 전역
  key         VARCHAR(120) NOT NULL,
  value       JSONB        NOT NULL,
  "updatedAt" TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- 복합 unique — Postgres 에서 NULL 은 unique 비교 시 다 다름으로 취급되므로
-- userId NULL 인 행이 같은 (mapId, key) 로 여러 개 들어갈 수 있음 → 두 partial index 로 보강.
CREATE UNIQUE INDEX IF NOT EXISTS world_data_user_key_unique
  ON world_data ("mapId", "userId", key)
  WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS world_data_global_key_unique
  ON world_data ("mapId", key)
  WHERE "userId" IS NULL;

CREATE INDEX IF NOT EXISTS world_data_map_user_idx
  ON world_data ("mapId", "userId");
