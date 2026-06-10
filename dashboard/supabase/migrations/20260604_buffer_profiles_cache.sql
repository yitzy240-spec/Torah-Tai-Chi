-- Phase 5.6 — Supabase-backed cache for Buffer's listProfiles response.
--
-- Why: Buffer's profile list almost never changes (operator connects/
-- disconnects a channel once a month at most), but every page render of
-- /videos/[slug] (Phase 5 + Live-at-rest), every /channels visit, every
-- /compose visit, and every autopilot webhook can call listProfiles.
-- We already wrap it in unstable_cache (24h TTL), but that cache lives
-- in Vercel's per-deployment data cache and is invalidated by:
--   - revalidatePath('/','layout') anywhere in the app
--   - revalidateTag('buffer-profiles') from /channels
--   - cold starts on a fresh Vercel deployment
--
-- Yonah hit Buffer's 100/day rate limit twice in 3 days because the
-- unstable_cache was being blown by autosave keystrokes — fixed at the
-- source in commits 731007f + 7eca088, but adding a Supabase-table
-- second-layer cache (with stale-on-error fallback) makes the system
-- robust to any future revalidate-storm we haven't predicted.
--
-- Shape: keyed by SHA-256 of the access token so a future rotation/
-- multi-account scenario gets its own bucket. Single row per token in
-- practice.

create table if not exists buffer_profiles_cache (
  token_hash text primary key,
  profiles jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table buffer_profiles_cache is
  'Survives-everything cache for Buffer listProfiles. listProfiles in lib/buffer.ts writes through on success and falls back to (potentially stale) cache rows when Buffer returns 4xx/5xx.';

comment on column buffer_profiles_cache.token_hash is
  'SHA-256 of the Buffer access token (hex). Lets us scope future multi-account tokens without storing the secret in plaintext.';

comment on column buffer_profiles_cache.profiles is
  'JSON array of BufferProfile objects ({id, service, service_username, formatted_service}) — same shape lib/buffer.ts returns.';

-- RLS: service-role only (this cache is server-side infrastructure;
-- no authed user ever reads it directly).
alter table buffer_profiles_cache enable row level security;
-- No policy = service-role-only access via createServiceClient bypass.

-- 2026-06-10: org id is immutable per token; caching it here removes the
-- second Buffer call (getOrgId) from every cold getPostExternalLinks.
-- add column if not exists keeps this idempotent for environments where
-- the table was already created from an earlier version of this file.
alter table buffer_profiles_cache add column if not exists org_id text;

comment on column buffer_profiles_cache.org_id is
  'Buffer organization id for this token (immutable). Populated lazily by getOrgId in lib/buffer.ts.';
