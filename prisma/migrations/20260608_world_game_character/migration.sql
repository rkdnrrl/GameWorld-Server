-- World 에 제작자 지정 "게임 캐릭터" appearance 스냅샷 컬럼 추가.
-- null = 플레이어 본인 캐릭터 사용 / object = 모든 입장 플레이어가 이 캐릭터로 플레이.
-- Supabase SQL Editor 에서 직접 실행할 것 (prisma migrate deploy 사용 안 함).
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS "gameCharacter" jsonb;
