-- Phase 4.4 / 4.5 / 4.6 — performance migrations.
--
-- Applied manually via Supabase SQL editor on 2026-06-04 by yitzym
-- BEFORE the auto-migrate workflow was activated. Committed here so the
-- repo and prod schema stay in sync.
--
-- Why each:
--
-- 4.4: ALTER PUBLICATION supabase_realtime ADD TABLE jobs
--   Without this, 5 dashboard useRealtimeRow('jobs', ...) subscriptions are
--   silently dead. The 4-10s poll fallbacks were carrying 100% of the work,
--   producing 30-48 polls/min per open /videos/[slug] page. After this,
--   realtime delivers job-status changes and the polls can drop to ~2/min.
--   ALTER PUBLICATION ADD TABLE raises 42710 on re-add — DO block + EXCEPTION
--   per the project memory (feedback_alter_publication_not_idempotent).
--
-- 4.5: composite index on clip_plans(job_id, created_at desc)
--   8+ hot call sites filter clip_plans by job_id and order by created_at desc
--   (every /videos/[slug] shell render, getCanonicalClipPlan in Phase 5,
--   live-at-rest, webhook, auto-post, job-progress 4s poll, purge cron,
--   realtime row filters). Was seq-scanning; now index scans.
--
-- 4.6: composite index on jobs(parsha_id, triggered_at desc)
--   trigger-generation idempotency check, resume-job lookups,
--   trigger-plan-only, and start-from-empty all filter by parsha_id and
--   order by triggered_at desc. No matching index existed.

do $$
begin
  alter publication supabase_realtime add table jobs;
exception when duplicate_object then
  raise notice 'jobs already in supabase_realtime publication — no-op';
end $$;

create index if not exists clip_plans_job_id_created_at_idx
  on clip_plans (job_id, created_at desc);

create index if not exists jobs_parsha_id_triggered_at_idx
  on jobs (parsha_id, triggered_at desc);
