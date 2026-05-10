-- 프로덕션 DB에 아직 pixelArt 컬럼이 없을 때 수동 실행 (PostgreSQL)
-- 적용 후 GameWorld-Server 프로세스 재시작
ALTER TABLE "catches" ADD COLUMN IF NOT EXISTS "pixelArt" JSONB;
