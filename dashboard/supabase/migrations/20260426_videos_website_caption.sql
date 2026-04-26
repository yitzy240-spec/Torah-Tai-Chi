-- Denormalized "website caption" on videos. Defaults to the auto-
-- generated Instagram caption (the longest / most narrative of the
-- per-platform captions Claude writes during clip planning). Distinct
-- from the spoken script — gives the website a marketing-voice
-- description rather than the read-aloud paragraphs.
--
-- The dashboard's caption editor will keep this in sync when Yonah
-- edits the Instagram caption (see update-caption.ts).
alter table videos add column if not exists website_caption text;

-- Backfill from each video's latest clip_plan.
update videos v
  set website_caption = (
    select cp.plan_json->'captions'->>'instagram'
    from clip_plans cp
    where cp.job_id = v.job_id
    order by cp.created_at desc
    limit 1
  )
  where website_caption is null;
