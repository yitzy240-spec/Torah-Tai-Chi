-- Backfill videos.title / subtitle / description for existing rows that
-- predate the stitch-time snapshot (spec §11.6). Walks the legacy job
-- chain to find the source script + parsha, then writes the snapshot.
-- Safe to run multiple times — only updates rows where at least one
-- of the three columns is still NULL.

-- Replay-order guard (added 2026-10-13). The three columns are created by
-- 20260517_video_page_redesign.sql, which sorts AFTER this file
-- ('b' < 'v'). Prod applied the two by hand in the right order, but a
-- lexical replay ran this UPDATE first and failed with "column title does
-- not exist". These are the same definitions video_page_redesign uses, so
-- whichever file runs first creates them and the other's ADD COLUMN IF
-- NOT EXISTS is a no-op. Chosen over renaming either file, so the names
-- humans used to record what was applied by hand stay valid. On prod
-- this whole file is still a no-op re-run.
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS subtitle TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

UPDATE videos v
SET
  title       = COALESCE(v.title,       p.name),
  subtitle    = COALESCE(v.subtitle,    s.title),
  description = COALESCE(v.description, s.tldr)
FROM jobs j
JOIN parshiot p ON p.id = j.parsha_id
LEFT JOIN scripts s ON s.id = j.script_id
WHERE v.job_id = j.id
  AND (v.title IS NULL OR v.subtitle IS NULL OR v.description IS NULL);
