-- Partial index for the Modal watchdog's stranded-job scans.
--
-- reap_stranded_jobs (modal_app.py, added 2026-07-20) runs two selects
-- every 10 minutes, forever:
--   status = 'queued'            AND triggered_at < cutoff AND completed_at IS NULL
--   status IN (<in-flight list>) AND triggered_at < cutoff AND completed_at IS NULL
-- No existing index serves (status, triggered_at); both were seq scans on
-- jobs 288x/day — flagged in the 2026-09-10 disk-IO audit. The partial
-- predicate keeps the index to only ACTIVE jobs (a handful of rows), so
-- it is near-free to maintain despite jobs being write-hot.
create index if not exists jobs_watchdog_active_idx
  on public.jobs (status, triggered_at)
  where completed_at is null;
