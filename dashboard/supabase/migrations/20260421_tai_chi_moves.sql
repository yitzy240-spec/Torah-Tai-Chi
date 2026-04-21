-- Tai chi reference-library table: mirrors references/tai_chi_moves/ on disk.
-- Populated via tools/sync_moves_to_supabase.py — the filesystem is the
-- source of truth; this table is a Supabase-accessible cache for the
-- dashboard picker and the Modal pipeline.
create table if not exists tai_chi_moves (
  slug               text primary key,
  english            text not null,
  pinyin             text not null,
  section            text not null,
  visual             text not null,
  motion_description text not null,
  mp4_storage_path   text not null,
  duration_s         int not null check (duration_s > 0 and duration_s <= 15),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists tai_chi_moves_section_idx on tai_chi_moves(section);

-- Yonah's optional pick persists on the script row so it survives reloads
-- and is reused across regenerations of the same script.
alter table scripts
  add column if not exists motion_ref_slug text references tai_chi_moves(slug)
    on delete set null;

-- Copied onto the job at trigger time (parsha path) or set directly by the
-- compose route (topic path). Single source of truth for the Modal worker.
alter table jobs
  add column if not exists motion_ref_slug text references tai_chi_moves(slug)
    on delete set null;

-- Set by the pipeline on the ONE clip that actually consumed the reference
-- video — provides an audit trail of which clip got the demo.
alter table clips
  add column if not exists motion_ref_url text;

-- RLS: match the pattern used in 0001_slice1_schema.sql. Reference-data
-- table, authenticated-read-only. tools/sync_moves_to_supabase.py runs
-- with the service-role key, which bypasses RLS.
alter table tai_chi_moves enable row level security;

create policy "authed read tai_chi_moves" on tai_chi_moves
  for select using (auth.role() = 'authenticated');

-- FK-side indexes so ON DELETE SET NULL and reverse lookups don't seq-scan
-- scripts/jobs. Partial on NOT NULL because the column is null for most rows.
create index if not exists scripts_motion_ref_slug_idx
  on scripts(motion_ref_slug) where motion_ref_slug is not null;
create index if not exists jobs_motion_ref_slug_idx
  on jobs(motion_ref_slug) where motion_ref_slug is not null;
