-- Per-video and per-clip feedback. clip_id is NULL for general feedback.
-- applied_to_job_id is the regen job triggered by this feedback once it
-- runs; remains NULL until the regen is queued.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  clip_id uuid references clips(id) on delete set null,
  text text not null check (length(text) > 0),
  applied_to_job_id uuid references jobs(id) on delete set null,
  status text not null default 'submitted' check (status in ('submitted', 'processing', 'applied', 'rejected')),
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);
create index if not exists idx_feedback_video on feedback(video_id, created_at desc);
create index if not exists idx_feedback_clip on feedback(clip_id) where clip_id is not null;

-- Version chain: links a regen job to its parent so the UI can show
-- "Version 2 (regen of v1)" and the pipeline can pull feedback context.
alter table jobs add column if not exists regen_of_job_id uuid references jobs(id) on delete set null;
create index if not exists idx_jobs_regen_of on jobs(regen_of_job_id) where regen_of_job_id is not null;

-- RLS for feedback: same authenticated-user access pattern as jobs.
alter table feedback enable row level security;
create policy "authed all feedback" on feedback for all using (auth.role() = 'authenticated');
