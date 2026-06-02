-- ============================================================
-- Reference model 마이그레이션
--   1. user_character_library 테이블 생성 (User × Character n:n + 본인 custom)
--   2. 기존 Character 의 modelUrl 기반 dedupe — 같은 modelUrl 의 row 들 중 canonical 1개만 남기고
--      나머지는 library 엔트리로 변환
--   3. 옛 row 들의 userId/isActive/custom 값을 library 로 옮긴 후 옛 row 삭제
--
-- ⚠️ Supabase SQL Editor 에서 한 번에 실행. 트랜잭션 없이 라인별 진행 (rollback 시 수동 정리).
-- 실행 전 백업 권장 (pg_dump 또는 Supabase snapshot).
-- ============================================================

-- ============================================================
-- 1. 새 테이블 생성
-- ============================================================
CREATE TABLE IF NOT EXISTS "user_character_library" (
  "id"             TEXT      NOT NULL,
  "userId"         TEXT      NOT NULL,
  "characterId"    TEXT      NOT NULL,
  "is_active"      BOOLEAN   NOT NULL DEFAULT FALSE,
  "custom_scale"   DOUBLE PRECISION,
  "custom_y_offset" DOUBLE PRECISION,
  "custom_rot_x"   DOUBLE PRECISION,
  "added_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_character_library_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_character_library_userId_characterId_key"
  ON "user_character_library"("userId", "characterId");

CREATE INDEX IF NOT EXISTS "user_character_library_userId_is_active_idx"
  ON "user_character_library"("userId", "is_active");

CREATE INDEX IF NOT EXISTS "user_character_library_characterId_idx"
  ON "user_character_library"("characterId");

ALTER TABLE "user_character_library"
  ADD CONSTRAINT "user_character_library_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_character_library"
  ADD CONSTRAINT "user_character_library_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "characters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================
-- 2. 기존 데이터 마이그레이션
-- ============================================================
-- 2a. modelUrl 기반 dedupe — 같은 URL 의 Character row 들에서 canonical 1개 선정
--     우선순위: isOfficial > isPublic > createdAt 가장 오래된 > id 사전순
--     선정된 canonical 의 id 를 dedupe_map.canonical_id 에 저장, 나머지 id 는 alias_id.
CREATE TEMP TABLE dedupe_map AS
WITH ranked AS (
  SELECT
    id,
    appearance->>'modelUrl' AS model_url,
    ROW_NUMBER() OVER (
      PARTITION BY appearance->>'modelUrl'
      ORDER BY
        "is_official" DESC,
        "is_public"   DESC,
        "createdAt"   ASC,
        id            ASC
    ) AS rn
  FROM characters
  WHERE appearance->>'modelUrl' IS NOT NULL
    AND appearance->>'modelUrl' != ''
),
canonicals AS (
  SELECT id AS canonical_id, model_url FROM ranked WHERE rn = 1
)
SELECT
  r.id AS alias_id,
  c.canonical_id,
  r.model_url
FROM ranked r
JOIN canonicals c ON c.model_url = r.model_url
WHERE r.id != c.canonical_id;

-- 2b. 각 옛 Character (canonical + alias 모두) 의 userId 가 있으면 library 엔트리 만들기.
--     canonical 의 user 도 library 에 등록 (운영자 본인 사본 케이스).
INSERT INTO user_character_library (id, "userId", "characterId", is_active, custom_scale, custom_y_offset, custom_rot_x, added_at)
SELECT
  -- cuid 같은 형식이 아니라도 OK — PK 만 unique 면 됨. gen_random_uuid() 로 충분.
  REPLACE(gen_random_uuid()::TEXT, '-', '') AS id,
  c."userId",
  COALESCE(dm.canonical_id, c.id) AS character_id,  -- alias 라면 canonical 로 매핑
  c."is_active",
  (c.appearance->>'modelScale')::FLOAT AS custom_scale,
  (c.appearance->>'fbxOffsetY')::FLOAT AS custom_y_offset,
  (c.appearance->>'fbxRotX')::FLOAT    AS custom_rot_x,
  c."createdAt"
FROM characters c
LEFT JOIN dedupe_map dm ON dm.alias_id = c.id
WHERE c."userId" IS NOT NULL
ON CONFLICT ("userId", "characterId") DO UPDATE SET
  -- 이미 (userId, canonical_id) 가 있으면 — 가장 최근의 isActive/custom 값 우선
  is_active       = EXCLUDED.is_active OR user_character_library.is_active,
  custom_scale    = COALESCE(EXCLUDED.custom_scale,    user_character_library.custom_scale),
  custom_y_offset = COALESCE(EXCLUDED.custom_y_offset, user_character_library.custom_y_offset),
  custom_rot_x    = COALESCE(EXCLUDED.custom_rot_x,    user_character_library.custom_rot_x);

-- 2c. alias Character row 들 삭제 (canonical 만 남음)
--     ⚠️ 이 단계는 신중하게 — Asset 등 다른 테이블에서 character id 를 참조하지 않는지 확인 필요.
--     현재 스키마상 Character id 를 직접 FK 참조하는 다른 테이블은 없으므로 안전.
DELETE FROM characters WHERE id IN (SELECT alias_id FROM dedupe_map);

-- 2d. 옛 Character.userId / is_active 는 새 모델에선 deprecated. 일단 그대로 두고
--     API 가 새 라이브러리 기반으로 전환되면 Phase D 에서 정리.
--     (즉시 NULL 처리하면 옛 코드가 깨짐 — 공존 기간 유지.)


-- ============================================================
-- 3. 검증 쿼리 (실행 후 수동 확인)
-- ============================================================
-- SELECT COUNT(*) AS library_rows FROM user_character_library;
-- SELECT COUNT(*) AS distinct_chars_with_url FROM (SELECT DISTINCT appearance->>'modelUrl' FROM characters WHERE appearance->>'modelUrl' IS NOT NULL) x;
-- SELECT COUNT(*) AS char_rows FROM characters;
-- 기대: library_rows >= char_rows (한 char 를 여러 유저가 가질 수 있으므로)
