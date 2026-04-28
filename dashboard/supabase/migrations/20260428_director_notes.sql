-- Director notes: optional free-form Yonah guidance ("set the outdoor clips
-- by a slow river") that the director agent receives as scene/feel context,
-- not as structural overrides. `scripts.director_notes` persists across
-- re-runs; `jobs.director_notes` is a per-run snapshot that the Modal worker
-- reads — once a job is queued, later edits to the script's notes don't
-- affect the running pipeline.

alter table scripts add column if not exists director_notes text;
alter table jobs    add column if not exists director_notes text;
