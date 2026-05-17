-- Backfill videos.title / subtitle / description for existing rows that
-- predate the stitch-time snapshot (spec §11.6). Walks the legacy job
-- chain to find the source script + parsha, then writes the snapshot.
-- Safe to run multiple times — only updates rows where at least one
-- of the three columns is still NULL.

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
