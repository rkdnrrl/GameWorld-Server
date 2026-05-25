-- ────────────────────────────────────────────────────────────────────
-- Asset Kinds 시스템 (Phase 1)
-- 운영자가 새 타입(sound/video 등) 동적으로 추가 가능한 구조
-- ────────────────────────────────────────────────────────────────────

-- 1) 타입 정의 테이블
CREATE TABLE IF NOT EXISTS asset_kinds (
  id           TEXT PRIMARY KEY,                 -- 'model','image','audio'
  label        TEXT NOT NULL,
  icon         TEXT,                             -- 이모지/아이콘
  extensions   TEXT[] NOT NULL,                  -- ['fbx','glb']
  "mimeTypes"  TEXT[],                           -- ['model/','application/octet-stream'] (옵셔널 검증)
  "maxSizeMb"  INTEGER NOT NULL DEFAULT 50,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) assets 확장
ALTER TABLE assets ADD COLUMN IF NOT EXISTS kind        TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS metadata    JSONB DEFAULT '{}'::jsonb;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS tags        TEXT[] DEFAULT '{}';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS folder      TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS "fileSize"  BIGINT;

-- 3) FK (실패해도 무시 — 데이터 정합성은 운영 후 확인)
DO $$ BEGIN
  ALTER TABLE assets
    ADD CONSTRAINT assets_kind_fkey
    FOREIGN KEY (kind) REFERENCES asset_kinds(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4) 인덱스
CREATE INDEX IF NOT EXISTS idx_assets_kind          ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_assets_tags          ON assets USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_assets_folder        ON assets(folder);
CREATE INDEX IF NOT EXISTS idx_assets_owner_created ON assets("creatorId", "createdAt" DESC);

-- 5) 시드 데이터 — 기본 2종 (Phase 1)
INSERT INTO asset_kinds (id, label, icon, extensions, "mimeTypes", "maxSizeMb", "sortOrder", enabled)
VALUES
  ('model', '3D 모델', '🎲', ARRAY['fbx','glb','obj','gltf'], ARRAY['model/','application/octet-stream'], 100, 10, true),
  ('image', '이미지',  '🖼️', ARRAY['png','jpg','jpeg','webp'], ARRAY['image/'],                              5, 20, true)
ON CONFLICT (id) DO NOTHING;

-- 6) 기존 데이터 백필
--    파일 확장자 보고 kind 자동 부여
UPDATE assets SET kind = 'model'
WHERE kind IS NULL AND lower("modelUrl") ~ '\.(fbx|glb|obj|gltf)(\?|$)';

UPDATE assets SET kind = 'image'
WHERE kind IS NULL AND lower("modelUrl") ~ '\.(png|jpg|jpeg|webp)(\?|$)';

-- 7) materialConfig → metadata.materialConfig 이전 (있으면)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='assets' AND column_name='materialConfig'
  ) THEN
    UPDATE assets
      SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{materialConfig}', "materialConfig")
      WHERE "materialConfig" IS NOT NULL;
    -- 컬럼 자체는 일단 남겨둠 — 다음 마이그레이션에서 drop (롤백 여유)
  END IF;
END $$;
