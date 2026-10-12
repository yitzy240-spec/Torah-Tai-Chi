-- Minimal Supabase shims so dashboard/supabase/migrations/*.sql replay on a
-- vanilla postgres:15 (CI db-schema job, tools/schema_snapshot.py).
-- Applied ONCE, before 0001_slice1_schema.sql. Never applied to prod.
--
-- What the migrations need from Supabase (audited 2026-10-13):
--   * auth.users(id)            FK target (scripts.approved_by, jobs.triggered_by,
--                               settings.user_id, feedback.created_by)
--   * auth.role()               used in RLS policies
--   * roles anon/authenticated  used in `to <role>` policy clauses
--   * supabase_realtime         ALTER PUBLICATION ... ADD TABLE (20260517, 20260604)
-- auth.uid()/auth.jwt()/service_role are not used by migrations but are
-- created so policies/tests that grow to need them keep working.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt() ->> 'role', '')::text
$$;

GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
