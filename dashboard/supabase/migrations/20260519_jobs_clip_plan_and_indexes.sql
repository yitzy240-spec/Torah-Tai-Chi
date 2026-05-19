-- Per spec §11.1 Modal pipeline split: the new `clips-only` job kind
-- needs to know WHICH clip_plan to render and WHICH clip indexes (subset
-- vs. all). Without these columns, modal_app.py clips_only_job falls
-- back to "render all clips of the plan via regen_of_job_id chain walk,"
-- which works but loses the subset-render that Phase 2's per-card
-- "Generate this clip" button needs.
--
-- jobs.clip_plan_id   — the clip_plan being targeted by this job (NULL
--                       for non-clips-only kinds; nullable FK to clip_plans.id)
-- jobs.clip_indexes   — optional subset of clip indexes to render. NULL =
--                       render all clips in the plan. Used by single-clip
--                       "Generate this clip" in Phase 2 UI.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS clip_plan_id UUID REFERENCES clip_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clip_indexes INTEGER[];

COMMENT ON COLUMN jobs.clip_plan_id IS
  'For clips-only jobs: the clip_plan being rendered. NULL for other kinds. Set at trigger time by trigger-clips.ts.';
COMMENT ON COLUMN jobs.clip_indexes IS
  'For clips-only jobs: optional subset of clip indexes to render (NULL = render all). Used by per-card Generate in Phase 2 UI.';
