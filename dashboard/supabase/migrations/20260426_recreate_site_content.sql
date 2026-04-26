-- Recreate site_content as a simple kv store for dashboard settings
-- (stance, default_tier). The CMS data that originally lived here moved
-- to Storyblok in April 2026 (see website/supabase/migrations/
-- 20260417_drop_cms_tables.sql) — but the dashboard kept upserting to
-- this table for stance + default_tier, silently failing since the drop.
create table if not exists site_content (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz default now()
);

alter table site_content enable row level security;

-- Authenticated users can read settings (needed for settings page +
-- generate dialog pre-fill). Writes go through the service role and
-- bypass RLS, so no write policy needed.
drop policy if exists "auth read" on site_content;
create policy "auth read" on site_content
  for select to authenticated using (true);

-- Seed the default quality tier. 720p standard avoids the lip-sync
-- shakiness we saw on 720p fast.
insert into site_content (key, value, description) values
  ('settings.default_tier', '720p standard', 'Default quality tier for video generation')
on conflict (key) do update set value = excluded.value;
