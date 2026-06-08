-- World 에 "게임" 플래그 추가. true = 목록에서 🎮 배지·필터로 노출, description 이 게임 설명.
-- Supabase SQL Editor 에서 직접 실행할 것.
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS "isGame" boolean NOT NULL DEFAULT false;
