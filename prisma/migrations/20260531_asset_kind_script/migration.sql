-- script asset kind 추가 — 사용자가 만든 스크립트 컴포넌트를 Asset 으로 통합.
-- modelUrl 없이 metadata.code (string) + metadata.propsSchema + metadata.icon 등 저장.
-- 추후 인스펙터에서 ScriptComponent 처럼 컴포넌트로 부착 가능.

INSERT INTO asset_kinds (id, label, icon, extensions, "mimeTypes", "maxSizeMb", "sortOrder", enabled)
VALUES (
  'script',
  '스크립트',
  '📜',
  ARRAY['js']::text[],            -- 파일 확장자 (참고용 — 실제 업로드 X, 코드 입력)
  ARRAY['text/javascript']::text[],
  1,                                -- 1MB 제한
  50,
  true
)
ON CONFLICT (id) DO UPDATE SET
  label      = EXCLUDED.label,
  icon       = EXCLUDED.icon,
  extensions = EXCLUDED.extensions,
  "mimeTypes" = EXCLUDED."mimeTypes",
  "maxSizeMb" = EXCLUDED."maxSizeMb",
  enabled    = EXCLUDED.enabled;
