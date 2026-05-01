-- Track which clip_ids made up a composed video (NULL for normally-stitched videos).
alter table videos
  add column if not exists composed_from_clip_ids jsonb null;

-- Add 'compose' as an allowed jobs.kind. If the existing check constraint
-- enumerates values, drop and recreate it; otherwise this is a no-op.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'jobs_kind_check'
  ) then
    alter table jobs drop constraint jobs_kind_check;
  end if;
end$$;

alter table jobs
  add constraint jobs_kind_check
  check (kind in ('parsha', 'video_topic', 'compose'));

comment on column videos.composed_from_clip_ids is
  'Ordered array of clip UUIDs that were stitched into this video. NULL when the video was generated normally (not via compose).';
