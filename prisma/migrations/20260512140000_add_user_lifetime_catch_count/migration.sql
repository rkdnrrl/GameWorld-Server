-- AlterTable
ALTER TABLE "users" ADD COLUMN "lifetimeCatchCount" INTEGER NOT NULL DEFAULT 0;

-- 현재 DB에 남아 있는 포획 행 수로 초기화 (과거에 재료로 삭제된 행은 반영되지 않음)
UPDATE "users" u
SET "lifetimeCatchCount" = COALESCE(
  (SELECT COUNT(*)::int FROM "catches" c WHERE c."userId" = u."id"),
  0
);