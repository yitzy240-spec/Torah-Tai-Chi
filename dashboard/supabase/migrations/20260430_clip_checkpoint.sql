-- Per-clip checkpointing + per-clip surgery support.
--
-- Background: today the Modal pipeline writes individual clip mp4s only
-- to /tmp inside the worker. The clips.mp4_path column carries a literal
-- "internal/clip_NN.mp4" placeholder, NOT a real Storage path. Only the
-- final stitched mp4 lands in Supabase Storage.
--
-- This migration adds:
--   1. clips.storage_path — real Storage path written by run_pipeline as
--      each clip is generated. Lets surgical regen reuse clips 1,2,4,5
--      from the original run while only re-running clip 3.
--   2. clips.regen_of_clip_id — clip-level version chain mirroring
--      jobs.regen_of_job_id; lets us tell a "freshly generated for this
--      surgery run" clip apart from a "copy of the parent's clip with
--      the same Storage path".
--   3. jobs.feedback_clip_index — when a regen targets a single clip,
--      this is its integer index. NULL = full regen (legacy behavior).
--
-- All operations are idempotent — safe to re-run if applied partially.
alter table clips add column if not exists storage_path text;

alter table clips add column if not exists regen_of_clip_id uuid
  references clips(id) on delete set null;

create index if not exists idx_clips_storage_path
  on clips(storage_path) where storage_path is not null;

-- The clip the regen targets. NULL = full regen (existing behavior).
-- Set when the user clicks "Fix this clip" instead of general feedback.
alter table jobs add column if not exists feedback_clip_index int;
