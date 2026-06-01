-- 공식 월드는 creator 탈퇴해도 보존되도록.
-- 1) creatorId → nullable, FK SetNull
-- 2) isOfficial 컬럼 추가

ALTER TABLE worlds ADD COLUMN IF NOT EXISTS "isOfficial" BOOLEAN NOT NULL DEFAULT false;

-- 기존 FK 제거 (이름 다를 수 있어 try/catch 안전 패턴 — DO block)
DO $$
BEGIN
  -- 자동 생성된 FK 이름 찾아 drop
  EXECUTE (
    SELECT 'ALTER TABLE worlds DROP CONSTRAINT IF EXISTS ' || quote_ident(conname)
    FROM pg_constraint
    WHERE conrelid = 'worlds'::regclass AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%REFERENCES profiles%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- creatorId nullable 로 변경
ALTER TABLE worlds ALTER COLUMN "creatorId" DROP NOT NULL;

-- 새 FK — onDelete SetNull
ALTER TABLE worlds
  ADD CONSTRAINT worlds_creatorId_fkey
  FOREIGN KEY ("creatorId") REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS worlds_isOfficial_idx ON worlds ("isOfficial");
