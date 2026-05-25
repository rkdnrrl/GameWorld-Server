-- Asset 에 머티리얼/텍스처 설정 컬럼 추가
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS "materialConfig" JSONB;
