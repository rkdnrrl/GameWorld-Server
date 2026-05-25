-- ────────────────────────────────────────────────────────────────────
-- Asset Kinds Phase 3 시드 — 오디오/비디오 활성화
-- 핸들러 코드 (kinds/audio.tsx, kinds/video.tsx) 가 등록되어
-- 인라인 재생 가능
-- ────────────────────────────────────────────────────────────────────

INSERT INTO asset_kinds (id, label, icon, extensions, "mimeTypes", "maxSizeMb", "sortOrder", enabled)
VALUES
  ('audio', '오디오', '🎵', ARRAY['mp3','wav','ogg','m4a'], ARRAY['audio/'], 20, 30, true),
  ('video', '비디오', '🎬', ARRAY['mp4','webm'],           ARRAY['video/'], 100, 40, true)
ON CONFLICT (id) DO NOTHING;
