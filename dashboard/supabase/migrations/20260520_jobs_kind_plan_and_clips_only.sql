-- Per spec §11.1: the Modal pipeline split introduces two new job kinds —
-- `plan-only` (Claude plan generation, no clip rendering) and `clips-only`
-- (clip rendering against an existing plan). The existing jobs_kind_check
-- constraint (set in 20260501_compose.sql) only allows 'parsha',
-- 'video_topic', 'compose', so triggerPlanOnly / triggerClips inserts
-- have been silently rejected with a check-constraint violation.
--
-- Without this migration, "Next: review clip plan" (Phase 1 → 2) and
-- "Generate all N clips" (Phase 2 → 3) both fail at the DB layer and
-- the actions return ok:false. The UI shows no error because no Toaster
-- is mounted (separately fixed). End result: button appears to do nothing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_kind_check'
  ) THEN
    ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
  END IF;
END$$;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_kind_check
  CHECK (kind IN ('parsha', 'video_topic', 'compose', 'plan-only', 'clips-only'));
