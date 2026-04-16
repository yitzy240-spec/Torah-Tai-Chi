-- Slice 1: schema for auth-gated parsha picker, pipeline triggering,
-- job progress tracking, video display, cost surfacing.

-- Enable pgcrypto for gen_random_uuid
create extension if not exists pgcrypto;

create table parshiot (
  id uuid primary key default gen_random_uuid(),
  "order" int not null unique,
  name text not null,
  slug text not null unique,
  book text not null,
  hebrew_name text,
  special_flag text
);

create table scripts (
  id uuid primary key default gen_random_uuid(),
  parsha_id uuid not null references parshiot(id) on delete cascade,
  option text not null check (option in ('A','B','C','A-tight')),
  title text not null,
  style_note text,
  draft_text text not null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz default now(),
  unique (parsha_id, option)
);

create type job_status as enum (
  'queued', 'loading_parsha', 'generating_plan', 'uploading_refs',
  'generating_clips', 'stitching', 'done', 'failed', 'cancelled'
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  parsha_id uuid not null references parshiot(id),
  script_id uuid references scripts(id),
  status job_status not null default 'queued',
  status_message text,
  triggered_by uuid references auth.users(id),
  triggered_at timestamptz default now(),
  completed_at timestamptz,
  total_cost_usd numeric(10,4) default 0,
  error_message text
);

create table clip_plans (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  plan_json jsonb not null,
  claude_cost_usd numeric(10,4) default 0,
  created_at timestamptz default now()
);

create table clips (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  index int not null,
  voiceover text not null,
  visual_prompt text not null,
  setting_id text not null,
  duration_s int not null,
  seedance_task_id text,
  mp4_path text,           -- path inside Supabase Storage bucket
  status text default 'pending',
  cost_usd numeric(10,4) default 0,
  created_at timestamptz default now(),
  completed_at timestamptz,
  unique (job_id, index)
);

create table videos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade unique,
  mp4_path text not null,
  duration_s numeric(5,1),
  created_at timestamptz default now()
);

create table cost_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete set null,
  action text not null,              -- 'clipplan' | 'clip' | 'caption' | 'regen' | 'image_ref'
  vendor text not null,              -- 'kie' | 'anthropic'
  cost_usd numeric(10,4) not null,
  notes text,
  created_at timestamptz default now()
);

create table settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz default now(),
  unique (user_id, key)
);

-- Row-Level Security: all three pre-provisioned users see everything.
-- (We re-tighten this when we add external users later.)
alter table parshiot enable row level security;
alter table scripts enable row level security;
alter table jobs enable row level security;
alter table clip_plans enable row level security;
alter table clips enable row level security;
alter table videos enable row level security;
alter table cost_events enable row level security;
alter table settings enable row level security;

create policy "authed read parshiot" on parshiot for select using (auth.role() = 'authenticated');
create policy "authed read scripts" on scripts for select using (auth.role() = 'authenticated');
create policy "authed all jobs" on jobs for all using (auth.role() = 'authenticated');
create policy "authed all clip_plans" on clip_plans for all using (auth.role() = 'authenticated');
create policy "authed all clips" on clips for all using (auth.role() = 'authenticated');
create policy "authed all videos" on videos for all using (auth.role() = 'authenticated');
create policy "authed all cost_events" on cost_events for all using (auth.role() = 'authenticated');
create policy "authed all settings" on settings for all using (auth.role() = 'authenticated');

-- Helpful indexes
create index jobs_triggered_at_idx on jobs (triggered_at desc);
create index clips_job_id_index on clips (job_id, index);
create index cost_events_job_id_idx on cost_events (job_id);
create index cost_events_created_at_idx on cost_events (created_at desc);
