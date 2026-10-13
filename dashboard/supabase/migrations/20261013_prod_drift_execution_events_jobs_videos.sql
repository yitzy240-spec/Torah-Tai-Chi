-- Prod objects that existed in the live database but in NO migration.
--
-- Found 2026-10-13 by replaying every migration into an empty Postgres and
-- diffing it against prod dumps (information_schema columns, plus
-- .qa/prod_objects.json: functions, indexes, triggers, PKs, RLS flags,
-- realtime publication, execution_events columns and policies). Every
-- definition below is copied from those dumps, so this file matches prod
-- exactly and is a NO-OP when applied to prod. It exists so a database
-- built from migrations (CI, a new environment, disaster recovery) gets
-- the same schema the pipeline writes to.
--
-- Fully idempotent: IF NOT EXISTS everywhere, constraints guarded by DO
-- blocks, ENABLE ROW LEVEL SECURITY is a no-op when already on.
--
-- Replaces the CI-only shim tests/schema/prod_drift.sql.

-- 1. execution_events: the diagnostics feed. Written by src/events.py and
--    dashboard/src/lib/events.ts, read by /admin/events and the purge cron
--    (all via the service-role client).
CREATE TABLE IF NOT EXISTS public.execution_events (
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

CREATE INDEX IF NOT EXISTS execution_events_created_at_idx
  ON public.execution_events USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS execution_events_subject_idx
  ON public.execution_events USING btree (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS execution_events_level_idx
  ON public.execution_events USING btree (level)
  WHERE (level = ANY (ARRAY['warn'::text, 'error'::text]));

-- RLS on with NO policies, as in prod: only the service role (which
-- bypasses RLS) can read or write. Prod has no CHECK on actor/level either.
ALTER TABLE public.execution_events ENABLE ROW LEVEL SECURITY;

-- 2. jobs.resolution / jobs.model_tier: the dashboard's quality-tier picker,
--    read by every Modal worker to choose the Seedance variant.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS resolution text DEFAULT '720p'::text,
  ADD COLUMN IF NOT EXISTS model_tier text DEFAULT 'standard'::text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_resolution_check' AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_resolution_check
      CHECK ((resolution = ANY (ARRAY['480p'::text, '720p'::text, '1080p'::text])));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_model_tier_check' AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_model_tier_check
      CHECK ((model_tier = ANY (ARRAY['standard'::text, 'fast'::text])));
  END IF;
END $$;

-- 3. videos.thumb_path (stitch-time thumbnail) and videos.stitch_settings
--    (crossfade/transition settings used by compose + restitch).
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS thumb_path text,
  ADD COLUMN IF NOT EXISTS stitch_settings jsonb;
