-- script_components 에 isOfficial 컬럼 추가.
-- 운영자가 만든 "공식" 컴포넌트는 모든 유저에게 노출됨 (picker 의 OFFICIAL 섹션).

ALTER TABLE script_components
  ADD COLUMN IF NOT EXISTS "isOfficial" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS script_components_official_updated_idx
  ON script_components("isOfficial", "updatedAt" DESC);
