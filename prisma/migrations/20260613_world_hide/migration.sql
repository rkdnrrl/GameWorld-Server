-- 운영자 월드 비공개 처리(소프트 takedown) 필드. Supabase SQL Editor 에서 직접 실행.
-- true = 목록/입장 차단 + 제작자 재공개 불가. 가역(unhide 가능). 하드 삭제(DELETE)와 달리 보존됨.
ALTER TABLE worlds
  ADD COLUMN IF NOT EXISTS "hiddenByOp" BOOLEAN NOT NULL DEFAULT false;
