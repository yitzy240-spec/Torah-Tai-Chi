-- Atomic dedup for plan-only jobs. Two concurrent "queued" inserts for the
-- same (parsha_id, script_id) — the double-submit race — now collide on this
-- index; one wins, the other gets a 23505 unique_violation which
-- triggerPlanOnly catches and resolves to the existing job. The predicate
-- covers only ACTIVE statuses, so once a job finishes/fails/cancels its entry
-- drops out and a deliberate later regen is unaffected. Plain (non-CONCURRENT)
-- index: the jobs table is small (single-operator app), so the brief lock is
-- negligible, and this stays transaction-safe for the Supabase SQL editor.
create unique index if not exists uniq_active_plan_only_job
  on jobs (parsha_id, script_id)
  where kind = 'plan-only'
    and status in ('queued', 'loading_parsha', 'generating_plan', 'verifying');
