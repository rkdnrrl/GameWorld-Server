-- 게임 재업로드 검수 — 보류 중인 업데이트 정보 컬럼 추가.
-- 라이브(production) 게임은 그대로 두고, 새 zip 은 R2 의 games-staging/{slug}/ 에 올린 뒤 운영자 승인 후 production 으로 교체.

ALTER TABLE "games"
  ADD COLUMN IF NOT EXISTS "pendingStoragePath"   VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "pendingVersion"       INTEGER,
  ADD COLUMN IF NOT EXISTS "pendingUploadedAt"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "pendingRejectReason"  VARCHAR(500);
