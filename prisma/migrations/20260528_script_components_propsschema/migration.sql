-- script_components 에 propsSchema 컬럼 추가.
-- 컴포넌트 작성자가 각 prop 의 타입/기본값/선택지를 정의 → Studio 가 자동으로 적절한 input UI 렌더.
--
-- 형식: [
--   { key: 'axis',  label: '축',   type: 'enum',   default: 'y', options: ['x','y','z'] },
--   { key: 'speed', label: '속도', type: 'number', default: 60,  min: -720, max: 720, step: 10 },
-- ]
-- 빈 배열이면 기존처럼 free-form key:value 입력 UI 로 fallback.

ALTER TABLE script_components
  ADD COLUMN IF NOT EXISTS "propsSchema" JSONB NOT NULL DEFAULT '[]'::JSONB;
