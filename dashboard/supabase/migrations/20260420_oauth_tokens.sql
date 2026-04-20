-- OAuth refresh tokens for direct-API integrations (YouTube, …).
-- Service-role only — no RLS policies defined, so PostgREST anon/authenticated
-- users cannot see these rows. The dashboard reads and writes via
-- createServiceClient() in lib/supabase/service.ts.

create table if not exists public.oauth_tokens (
  service                  text         primary key,
  refresh_token            text         not null,
  access_token             text,
  access_token_expires_at  timestamptz,
  account_id               text,
  account_name             text,
  scopes                   text[],
  connected_at             timestamptz  not null default now(),
  updated_at               timestamptz  not null default now()
);

alter table public.oauth_tokens enable row level security;

comment on table public.oauth_tokens is
  'OAuth refresh tokens for direct-API integrations (e.g. youtube). Service-role only — no policies.';
