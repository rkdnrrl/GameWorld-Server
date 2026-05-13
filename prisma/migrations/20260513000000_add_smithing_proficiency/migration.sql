-- 대장간 숙련도 (총 제련 횟수 누적 — craft 성공 1회마다 +1)
ALTER TABLE "users" ADD COLUMN "smithingProficiency" INTEGER NOT NULL DEFAULT 0;
