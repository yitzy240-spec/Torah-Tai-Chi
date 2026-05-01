-- Snapshot of voiceovers from the published video's clip plan, written
-- when setVideoPublished flips published_to_website=true. Lets the
-- website render the actual transcript of what's in the live video,
-- which can drift from scripts.draft_text after per-clip regens.
alter table videos
  add column if not exists spoken_script text null;

comment on column videos.spoken_script is
  'Transcript snapshot built from clip_plans.plan_json clips voiceovers at the moment of publish. NULL for videos that were never published; the source-of-truth script for the website remains scripts.draft_text as a fallback.';
