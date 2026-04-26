-- Website publish gate. Without this, two things were broken:
--
--   1. The website was silently empty on every video (only parshiot +
--      scripts had public-read policies; videos required auth, so the
--      anon key on torahtaichi.com got 0 rows even when the data existed).
--
--   2. There was no way for Yonah to gate publication. Once a job
--      finished in Modal the video was reachable to the public via the
--      website's 60-second ISR cache, with no review step. Pre-batching
--      would mean future weeks' videos leaked early.
--
-- Fix: a `published_to_website` flag (default false), a denormalized
-- parsha_id on videos so the website doesn't have to join through jobs
-- (which has internal cost + user fields), and an anon-read policy that
-- only exposes published rows.

-- 1. Denormalize parsha_id onto videos.
alter table videos add column if not exists parsha_id uuid references parshiot(id);
update videos v
  set parsha_id = j.parsha_id
  from jobs j
  where v.job_id = j.id and v.parsha_id is null;
create index if not exists videos_parsha_id_idx on videos(parsha_id);

-- 2. Publish gate. Opt-in by default — Yonah explicitly publishes after
-- review. Existing videos will not appear on the site until step 4.
alter table videos add column if not exists published_to_website boolean not null default false;
create index if not exists videos_published_idx
  on videos(published_to_website)
  where published_to_website = true;

-- 3. Anon read policy: only published rows are visible to the public site.
drop policy if exists "anon read published videos" on videos;
create policy "anon read published videos" on videos
  for select to anon using (published_to_website = true);

-- 4. Backfill: mark Emor's existing video as published so the live site
--    has something to render right after deploy. All other existing
--    videos stay unpublished — Yonah promotes them one by one.
update videos v
  set published_to_website = true
  from jobs j
  join parshiot p on p.id = j.parsha_id
  where v.job_id = j.id and p.slug = 'emor';
