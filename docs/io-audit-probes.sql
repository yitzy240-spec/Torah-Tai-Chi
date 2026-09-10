-- =====================================================================
-- Supabase disk-I/O audit probes — Torah Tai Chi
-- =====================================================================
-- Paste into the Supabase dashboard SQL Editor. All READ-ONLY.
--
-- History: disk-I/O-budget alerts on 2026-06-07 and 2026-09-10. The June
-- session ran probes like these but never saved them, so September had to
-- reinvent the analysis. This file exists so the NEXT alert (or the
-- post-fix measurement) is a copy-paste job.
--
-- Run ~48h after any I/O fix deploy, and compare call counts / disk reads
-- against the numbers recorded in the memory file:
--   C:\Users\yitzym\.claude\projects\c--Users-yitzym-git-torah-tai-chi\memory\project_io_budget_audit.md
--
-- Column names assume PG 13+ (total_exec_time, not total_time).
-- =====================================================================


-- ── 0. Did the 2026-09-10 watchdog index land? ───────────────────────
-- Expect a row: jobs_watchdog_active_idx
select indexname, indexdef
from pg_indexes
where tablename = 'jobs' and schemaname = 'public'
order by indexname;


-- ── 1. Top consumers by DISK READS (the actual I/O budget metric) ────
-- shared_blks_read = blocks fetched from disk (budget spend).
-- shared_blks_hit  = served from cache (free). High read:hit ratio = pain.
select
  round((shared_blks_read * 8192.0) / 1048576.0, 1) as disk_read_mb,
  round((shared_blks_hit  * 8192.0) / 1048576.0, 1) as cache_hit_mb,
  calls,
  round(total_exec_time::numeric / 1000, 1)          as total_sec,
  left(regexp_replace(query, '\s+', ' ', 'g'), 120)  as query
from pg_stat_statements
order by shared_blks_read desc
limit 25;


-- ── 2. Top by CALL COUNT — finds runaway polling loops ───────────────
-- 2026-09-10 finding: ungated router.refresh() loops from backgrounded
-- tabs. If a dashboard page query shows call counts in the 100k+ range
-- for a single-operator app, a poll is not gated.
select
  calls,
  round(total_exec_time::numeric / 1000, 1)          as total_sec,
  round(mean_exec_time::numeric, 2)                  as mean_ms,
  left(regexp_replace(query, '\s+', ' ', 'g'), 120)  as query
from pg_stat_statements
order by calls desc
limit 25;


-- ── 3. Top by TOTAL TIME ─────────────────────────────────────────────
select
  round(total_exec_time::numeric / 1000, 1)          as total_sec,
  calls,
  round(mean_exec_time::numeric, 2)                  as mean_ms,
  left(regexp_replace(query, '\s+', ' ', 'g'), 120)  as query
from pg_stat_statements
order by total_exec_time desc
limit 25;


-- ── 4. Realtime WAL decoder specifically ─────────────────────────────
-- The #1 consumer in the June audit. Driven by tables in the
-- supabase_realtime publication x write frequency. If this is still at
-- the top after the P1-P3 fixes, execute P4 (drop clips/videos/posts
-- from the publication + switch those pages to gated polling).
select
  calls,
  round(total_exec_time::numeric / 1000, 1) as total_sec,
  round((shared_blks_read * 8192.0) / 1048576.0, 1) as disk_read_mb,
  left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
from pg_stat_statements
where query ilike '%realtime%'
   or query ilike '%pg_logical_slot%'
   or query ilike '%list_changes%'
order by total_exec_time desc
limit 10;

-- Which tables are still WAL-decoded? (P4 targets: clips, videos, posts)
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;


-- ── 5. Write churn per table ─────────────────────────────────────────
-- n_tup_ins/upd/del drive WAL volume; dead tuples drive autovacuum I/O.
select
  relname,
  n_tup_ins as inserts, n_tup_upd as updates, n_tup_del as deletes,
  n_live_tup as live_rows, n_dead_tup as dead_rows,
  last_autovacuum
from pg_stat_user_tables
where schemaname = 'public'
order by (n_tup_ins + n_tup_upd + n_tup_del) desc
limit 20;


-- ── 6. Is the event-log retention working? ───────────────────────────
-- The nightly 03:00 purge cron deletes execution_events older than 30d
-- (shipped 2026-09-10). Expect oldest_event to stay within ~30 days and
-- the row count to plateau. cost_events is kept forever by design.
select
  (select count(*) from execution_events)                      as event_rows,
  (select min(created_at) from execution_events)               as oldest_event,
  (select count(*) from execution_events
     where created_at < now() - interval '30 days')            as rows_past_retention,
  (select count(*) from cost_events)                           as cost_rows;


-- ── 7. Is the watchdog index actually being used? ────────────────────
-- reap_stranded_jobs runs 2 scans every 10 min (144 ticks/day). After a
-- day, idx_scan should be in the hundreds. If it stays 0, the planner
-- isn't using it — investigate the predicate shape in modal_app.py.
select indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
from pg_stat_user_indexes
where relname = 'jobs'
order by idx_scan desc;


-- ── 8. Checkpoint pressure (was HEALTHY in June) ─────────────────────
-- Many "requested" vs "timed" checkpoints = write bursts outrunning
-- config. June: 14,848 timed / 55 requested over 52 days = fine.
-- (PG17+ moved these to pg_stat_checkpointer; try that if this errors.)
select * from pg_stat_bgwriter;


-- ── 9. Optional: reset the stats window ──────────────────────────────
-- Run ONCE right after a fix deploy so the next probe measures only the
-- post-fix period instead of being dominated by pre-fix history.
-- select pg_stat_statements_reset();
