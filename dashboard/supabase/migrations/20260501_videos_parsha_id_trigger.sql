-- The 20260426_videos_publish_gate migration denormalized parsha_id
-- onto videos and backfilled the existing Emor row, but it never added
-- a trigger to populate parsha_id on subsequent inserts. None of the
-- Modal pipeline code (run_pipeline, regen_agent, regen_single_clip,
-- compose_video) sets parsha_id on the video row either — they only
-- write job_id. The result: every video generated after Apr 26 has
-- parsha_id = NULL, the website filters by parsha_id, so the video
-- never appears on the public site even when published_to_website is
-- flipped true.
--
-- This migration:
--   1. Backfills every NULL parsha_id by joining through jobs.
--   2. Adds a BEFORE INSERT trigger so future inserts don't need the
--      caller to remember to set parsha_id — it derives from job_id.

-- 1. Backfill.
update videos v
  set parsha_id = j.parsha_id
  from jobs j
  where v.job_id = j.id
    and v.parsha_id is null
    and j.parsha_id is not null;

-- 2. Trigger function.
create or replace function videos_fill_parsha_id()
returns trigger
language plpgsql
as $$
begin
  if new.parsha_id is null and new.job_id is not null then
    select j.parsha_id into new.parsha_id
      from jobs j
      where j.id = new.job_id;
  end if;
  return new;
end;
$$;

-- 3. Trigger.
drop trigger if exists videos_fill_parsha_id_trg on videos;
create trigger videos_fill_parsha_id_trg
  before insert on videos
  for each row
  execute function videos_fill_parsha_id();

comment on function videos_fill_parsha_id is
  'Auto-derive videos.parsha_id from jobs.parsha_id on insert when the caller did not provide it. Stops the public website from silently hiding new videos when callers forget the denormalized field.';
