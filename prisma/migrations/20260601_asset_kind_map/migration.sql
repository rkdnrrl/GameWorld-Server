-- 'map' asset kind 추가 — 스튜디오 맵 스냅샷(오브젝트 + 환경 설정)을 Asset 으로 통합.
-- modelUrl 없음. metadata.data 에 { objects: [...], env: {...}, name, version } 저장.
-- 다른 유저는 가져와서 자기 맵에 합치기 가능 (id 재생성).

INSERT INTO asset_kinds (id, label, icon, extensions, "mimeTypes", "maxSizeMb", "sortOrder", enabled)
VALUES (
  'map',
  '맵',
  '🗺',
  ARRAY['json']::text[],
  ARRAY['application/json']::text[],
  2,                                -- 2MB metadata 제한 (오브젝트 많은 맵 대비)
  55,
  true
)
ON CONFLICT (id) DO UPDATE SET
  label      = EXCLUDED.label,
  icon       = EXCLUDED.icon,
  extensions = ARRAY['alp','json']::text[],
  "mimeTypes" = ARRAY['application/json','text/plain','application/octet-stream']::text[],
  "maxSizeMb" = EXCLUDED."maxSizeMb",
  enabled    = EXCLUDED.enabled;
