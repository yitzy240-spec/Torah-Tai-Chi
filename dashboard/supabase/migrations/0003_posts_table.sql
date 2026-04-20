create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  platform text not null check (platform in ('tiktok','instagram','youtube','facebook')),
  buffer_update_id text,
  scheduled_at timestamptz,
  published_at timestamptz,
  post_url text,
  status text not null default 'pending' check (status in ('pending','scheduled','published','failed')),
  caption text not null,
  created_at timestamptz default now()
);

alter table posts enable row level security;
create policy "authed all posts" on posts for all to authenticated using (true) with check (true);

-- Index for recent posts query by platform
create index posts_platform_created_at_idx on posts (platform, created_at desc);
create index posts_video_id_idx on posts (video_id);
