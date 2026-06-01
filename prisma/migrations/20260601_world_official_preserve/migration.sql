-- 한 번이라도 공개된 월드는 creator 탈퇴해도 보존.
-- 1) creatorId → nullable, FK SetNull (탈퇴 시 NULL 처리되어 보존)
-- 2) wasPublic 컬럼 추가 — 한 번 true 되면 다시 false 안 됨 (트리거)
-- 3) 트리거: isPublic = true 로 바뀌면 wasPublic 도 true 로 자동 설정

ALTER TABLE worlds ADD COLUMN IF NOT EXISTS "wasPublic" BOOLEAN NOT NULL DEFAULT false;

-- 기존 데이터: 현재 공개 상태인 월드는 이미 한 번 공개된 것이므로 wasPublic = true 로 backfill
UPDATE worlds SET "wasPublic" = true WHERE "isPublic" = true;

-- 기존 FK 제거 (이름 자동 탐색)
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name FROM pg_constraint
   WHERE conrelid = 'worlds'::regclass AND contype = 'f'
     AND pg_get_constraintdef(oid) LIKE '%REFERENCES profiles%'
   LIMIT 1;
  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE worlds DROP CONSTRAINT ' || quote_ident(c_name);
  END IF;
END $$;

-- creatorId nullable
ALTER TABLE worlds ALTER COLUMN "creatorId" DROP NOT NULL;

-- 새 FK — onDelete SetNull
ALTER TABLE worlds
  ADD CONSTRAINT worlds_creatorId_fkey
  FOREIGN KEY ("creatorId") REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS worlds_wasPublic_idx ON worlds ("wasPublic");

-- 트리거: isPublic 이 true 로 바뀌면 wasPublic 도 true 로. wasPublic 은 한 번 true 되면 다시 false 못 됨.
CREATE OR REPLACE FUNCTION worlds_protect_was_public() RETURNS trigger AS $$
BEGIN
  -- isPublic = true 인 순간 wasPublic 강제 true
  IF NEW."isPublic" = true THEN
    NEW."wasPublic" := true;
  END IF;
  -- wasPublic 을 false 로 되돌리려는 시도 무력화 (이미 true 였으면 강제로 true 유지)
  IF TG_OP = 'UPDATE' AND OLD."wasPublic" = true AND NEW."wasPublic" = false THEN
    NEW."wasPublic" := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS worlds_protect_was_public_trg ON worlds;
CREATE TRIGGER worlds_protect_was_public_trg
  BEFORE INSERT OR UPDATE ON worlds
  FOR EACH ROW EXECUTE FUNCTION worlds_protect_was_public();

-- (참고) isOfficial 컬럼이 이미 추가됐다면 그대로 두기 — 충돌 없음. 나중에 운영자 마킹 필요하면 별도 활용.
