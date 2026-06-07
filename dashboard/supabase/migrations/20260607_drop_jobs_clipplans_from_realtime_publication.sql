-- Drop jobs + clip_plans from the postgres_changes realtime publication.
--
-- After Phase 1 (commits d130536 through 210ccb2), no dashboard component
-- subscribes to postgres_changes on these tables. They've been replaced
-- with Supabase Broadcast subscriptions (via useJobStream) that don't
-- touch WAL at all.
--
-- Keeping these tables in the publication just costs WAL decode work on
-- every Modal write (which was the #1 disk-IO consumer per pg_stat_statements
-- on 2026-06-07: ~446k WAL parser calls / 60 min cumulative DB time over
-- ~52 days).
--
-- NOTE: clips is NOT dropped here. phase-2-plan-review.tsx still uses
-- useRealtimeRows<Clip>('clips', ...) (Mechanism 3, intentionally left
-- alone for Phase 1). The defensive 30s poll in that hook would keep it
-- functional if we dropped clips, but holding off until a follow-up phase
-- removes that hook entirely. Less risk for the production deploy.
--
-- Wrapped in DO blocks per `feedback_alter_publication_not_idempotent`:
-- ALTER PUBLICATION ... DROP TABLE raises 42704 (undefined_object) if the
-- table is not currently in the publication. Idempotent migration must
-- swallow that.

do $$
begin
  alter publication supabase_realtime drop table public.jobs;
exception when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime drop table public.clip_plans;
exception when undefined_object then null;
end $$;
