-- World 모델에 세션 시스템용 필드 추가
--   kind       : 'personal' (홈허브 등 1인용) | 'multi' (공개 세션 매칭)
--   maxPlayers : 세션당 최대 인원 cap
--
-- 참고: prisma/schema.prisma 에는 default 값이 정의되어 있지만,
-- Postgres ALTER COLUMN ADD 에서도 default 가 적용되어야 기존 row 가 자동 채워짐.

ALTER TABLE "worlds"
  ADD COLUMN IF NOT EXISTS "kind"       VARCHAR(20) NOT NULL DEFAULT 'multi',
  ADD COLUMN IF NOT EXISTS "maxPlayers" INTEGER     NOT NULL DEFAULT 50;
