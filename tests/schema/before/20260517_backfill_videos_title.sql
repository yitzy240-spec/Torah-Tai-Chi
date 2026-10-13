-- Replay-order shim (CI only; never applied to prod).
-- 20260517_backfill_videos_title.sql UPDATEs videos.title/subtitle/description,
-- but those columns are created by 20260517_video_page_redesign.sql, which
-- sorts AFTER it ('b' < 'v'). In prod the two were applied by hand in the
-- right order; a lexical replay fails with "column title does not exist".
-- video_page_redesign uses ADD COLUMN IF NOT EXISTS, so adding them early is
-- a no-op for the final schema. Do NOT fix by editing/renaming the migrations.
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS subtitle text,
  ADD COLUMN IF NOT EXISTS description text;
