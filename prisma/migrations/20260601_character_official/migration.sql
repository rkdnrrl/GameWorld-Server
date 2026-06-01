-- 공식 캐릭터 시스템. 운영자가 공식 등록한 캐릭터는 owner 탈퇴해도 서버 귀속 보존.
-- userId nullable + FK SetNull, isOfficial 컬럼 추가.

ALTER TABLE characters ADD COLUMN IF NOT EXISTS "is_official" BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name FROM pg_constraint
   WHERE conrelid = 'characters'::regclass AND contype = 'f'
     AND pg_get_constraintdef(oid) LIKE '%REFERENCES profiles%'
   LIMIT 1;
  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE characters DROP CONSTRAINT ' || quote_ident(c_name);
  END IF;
END $$;

ALTER TABLE characters ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE characters
  ADD CONSTRAINT characters_userId_fkey
  FOREIGN KEY ("userId") REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS characters_is_official_idx ON characters ("is_official");
