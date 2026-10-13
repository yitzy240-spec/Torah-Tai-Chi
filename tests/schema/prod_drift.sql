-- Prod objects that exist in the live database but in NO migration
-- (drift found 2026-10-13 by diffing a migration replay against a prod
-- information_schema dump). Applied by CI AFTER all migrations so the
-- replayed schema matches prod. Never applied to prod — it already has these.
--
-- The right long-term fix is a real (idempotent) migration carrying these
-- definitions; until a human decides that, they live here so the drift is
-- visible and the test DB matches what the pipeline actually writes to.

-- 1. execution_events: written by src/events.py + dashboard/src/lib/events.ts,
--    read by /admin/events and the purge cron. No CREATE TABLE anywhere.
--    Prod has no CHECK on actor/level. PK assumed (prod dump omits PKs).
CREATE TABLE IF NOT EXISTS execution_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,
  level        text NOT NULL,
  event        text NOT NULL,
  subject_type text,
  subject_id   uuid,
  message      text NOT NULL,
  details      jsonb,
  resolved     boolean NOT NULL DEFAULT false,
  resolved_at  timestamptz,
  resolved_by  text
);

-- 2. jobs.resolution / jobs.model_tier (quality-tier picker).
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS resolution text DEFAULT '720p',
  ADD COLUMN IF NOT EXISTS model_tier text DEFAULT 'standard';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_resolution_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_resolution_check
      CHECK (resolution IN ('480p', '720p', '1080p'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_model_tier_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_model_tier_check
      CHECK (model_tier IN ('standard', 'fast'));
  END IF;
END $$;

-- 3. videos.thumb_path (stitch-time thumbnail) and videos.stitch_settings.
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS thumb_path text,
  ADD COLUMN IF NOT EXISTS stitch_settings jsonb;
