# Torah Tai Chi Operations Runbook

**Audience:** anyone responsible for keeping the app running. Today that's primarily yitzym; if a second engineer ever picks this up, this is their on-call cheat sheet.

**Status:** living document. Add to it when you fix something that wasn't here.

---

## Incident triage flowchart

1. **What is broken?**
   - Public website (torahtaichi.com) won't load → see [Website 5xx](#website-5xx)
   - Dashboard won't load → see [Dashboard 5xx](#dashboard-5xx)
   - Job stuck "Generating…" >2h → see [Stuck job](#stuck-job)
   - Auto-post failed silently → see [Buffer/posting failure](#bufferposting-failure)
   - Database row corrupt / data lost → see [Supabase restore](#supabase-restore)
2. **Capture the time + symptom** for the post-mortem (Vercel logs roll off in 24h on the hobby tier).
3. **Tell Yonah** if a public-facing surface is broken so he can pause any operator actions.

---

## Supabase restore

**Scenario:** a migration dropped a column, a buggy script truncated a table, or a service-role action wiped production data.

### Prevention reminders
- **Always** run new migrations against a Supabase preview branch first (if on the paid tier with branching) OR a throwaway project.
- **Never** run `truncate` / `delete from <table>` in the SQL editor against prod without `where` clauses.
- Service-role-key actions bypass RLS — review them like raw SQL.

### Recovery — daily backup restore

Supabase Pro tier includes daily backups, retained 7 days. To restore:

1. **Stop writes** if possible:
   - Pause Vercel deployments: Vercel project → Settings → General → "Pause deployments"
   - Pause Modal worker: `modal app stop torah-tai-chi-pipeline`
   - Notify Yonah: "Don't tap any buttons for the next 30 min."
2. **Open Supabase project → Database → Backups.** Pick the backup just BEFORE the incident time.
3. **Decide: full restore vs surgical restore.**
   - **Full restore** (replaces the entire database): only if the corruption is widespread. Will lose ALL writes since the backup snapshot.
   - **Surgical restore** (extract specific rows from a restored copy into prod): preferred. Restore the backup into a NEW project (Supabase calls this "restore to another project"), then `pg_dump` the affected tables/rows from the restored copy and `psql` them back into prod.
4. **After restore:** unpause Vercel + Modal, smoke-test from Yonah's iPhone, watch `execution_events` for next 15 min for repeat errors.

### Point-in-time recovery (PITR)
Available on Supabase Team tier ($599/mo). We're not on it; if we ever upgrade, document the PITR runbook here.

### Quarterly dry-run
**Action:** every 3 months, restore the latest backup to a throwaway project. Verify you can connect + read a known row. Time-box to 30 min. Last dry-run: *(none — schedule first one)*.

---

## Stuck job

**Symptom:** a parsha video card shows "Generating…" or "Stitching your video…" for >2h. The job appears stuck.

### Triage
1. **Find the job:** `/admin/events` (dashboard) → filter by parsha slug → find the most recent `pipeline_started` event without a `pipeline_completed`/`pipeline_failed` follow-up.
2. **Check Modal:** `modal logs torah-tai-chi-pipeline --since 4h` and grep for the `job_id`.
3. **Common causes:**
   - **Kie/Seedance timeout** — Modal is waiting for a Seedance render that never returned. Check Kie dashboard for stuck task.
   - **OpenRouter 5xx** — Claude call failed and Modal's retry budget was exhausted. Look for `claude_call: HTTP 5xx` in modal logs.
   - **Webhook delivery dropped** — Modal finished but `/api/pipeline/video-complete` returned 5xx; Modal doesn't retry webhooks. The DB row stays at `status='running'` forever.

### Resolution
- **If Modal log shows the job actually completed** (last event was `pipeline_completed_local`): the webhook dropped. Manually mark the job done by re-firing the webhook handler:
  ```sql
  -- via Supabase SQL editor
  update jobs set status='done', completed_at=now() where id='<job_id>';
  ```
  Then trigger a `/api/pipeline/video-complete` POST manually or `revalidatePath('/videos/<slug>')` from a dashboard server action.
- **If Modal log shows the job is genuinely hung in Kie:** cancel the Kie task in their dashboard, then mark the job failed:
  ```sql
  update jobs set status='failed', error='Manual: stuck in Kie >2h' where id='<job_id>';
  ```
  The dashboard's "Retry" button on /videos/[slug] will re-trigger.
- **If Modal log shows uncaught exception:** read the traceback, fix the bug, redeploy Modal, then retry the job.

### Prevention
- Phase 1.11 in the [overhaul plan](superpowers/plans/2026-06-03-stability-ux-perf-overhaul.md) adds a "Stuck" tab to /videos that surfaces these silently.
- Phase 5.6 adds Buffer health monitoring; a similar Kie health probe is on the backlog.

---

## Buffer/posting failure

**Symptom:** auto-post fired but no live post appeared on Instagram/Facebook/X/YouTube/TikTok.

### Triage
1. Check the `posts` table: `select * from posts where video_id='<video_id>' order by created_at desc`. Look for rows with `status='failed'` or `status='scheduled'` but past their scheduled time.
2. Check Buffer dashboard: buffer.com/app/updates — find the post by platform + time.
3. Check Vercel logs: `vercel logs --since 1h` and grep for `auto-post` or the platform name.

### Common causes
- **Buffer GraphQL 429 (rate limit):** auto-post sniffs this via `String(e).includes('HTTP 429')` ([dashboard/src/lib/auto-post.ts:188](../dashboard/src/lib/auto-post.ts#L188)). Retry will happen on next attempt; if not, manually re-trigger from posting card.
- **Buffer GraphQL schema changed:** Buffer has shipped breaking changes 2× in 2026 already. Symptom: `body.data` is undefined or shape mismatch. Fix: read [dashboard/src/lib/buffer.ts](../dashboard/src/lib/buffer.ts) header comments for prior schema fixes; apply similar treatment.
- **YouTube OAuth expired:** token refresh failed. Re-auth at `/settings/youtube` → click "Reconnect".
- **Wrong account connected:** check `/channels` page — Buffer profile name should match the brand account.

### Resolution
- For a failed scheduled post: from the posting card on /videos/[slug], click "Retry" (if implemented per Phase 1.9 / Phase 0.9) or manually re-post via "Post to <platform>".
- For 429: wait 60s, retry. If repeated, check Buffer dashboard for plan limits.

---

## Website 5xx

**Symptom:** torahtaichi.com loads as Vercel error page or 500.

### Triage
1. **Vercel dashboard** → website project → Deployments tab → latest deployment → check build/runtime logs.
2. **Most common cause:** missing env var on Vercel. Audit found 4+ undocumented vars (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, etc.) that the contact form needs.
3. **Check `.env.local.example`** vs Vercel project env vars to spot missing.

### Resolution
- Add missing env var to Vercel → redeploy.
- Rollback if a code change is suspected: Vercel → Deployments → previous successful deployment → "Promote to Production".

### Prevention
- Phase 5.1 (env.ts requireEnv) will surface missing env vars at boot, not on first request.

---

## Dashboard 5xx

**Symptom:** admin.torahtaichi.com loads as error page.

### Triage
1. Same as Website 5xx — check Vercel dashboard project deployment.
2. Common: a missing env var added in a recent PR that wasn't synced to Vercel.
3. If Yonah can't sign in: check `/api/auth/callback/route.ts` logs for Supabase Auth errors.

### Resolution
- Vercel rollback if needed.
- For Supabase Auth: check Supabase Auth dashboard for rate limits / paused email provider / wrong redirect URL.

---

## Modal deploy procedure

**When:** any change to `modal_app.py` or `src/*.py` needs to deploy.

1. From repo root: `modal deploy modal_app.py` (or `modal app deploy` depending on Modal CLI version).
2. **Atomic deploy:** Modal swaps to the new version atomically. In-flight jobs on the old version finish on the old version.
3. **Verify:** trigger a test job from the dashboard (use a throwaway parsha if you don't want to ship real content) and watch `modal logs` for the new container version string.

### Rollback
- Modal stores N most recent app revisions. Find them via `modal app history torah-tai-chi-pipeline`.
- Rollback: `modal app rollback torah-tai-chi-pipeline <revision-id>`.

---

## Secrets rotation

### `PIPELINE_TRIGGER_SECRET`
See [overhaul plan item 0.11](superpowers/plans/2026-06-03-stability-ux-perf-overhaul.md) for the 6-step procedure. Summary: add new alongside old, deploy Modal with accept-either, switch dashboard to new, remove old.

### Supabase service role key
**Never rotate without warning** — every server action in the dashboard uses it. If rotation is required (compromise), follow:
1. Generate new key in Supabase → Project Settings → API.
2. Update Vercel env (`SUPABASE_SERVICE_ROLE_KEY`) on dashboard + website projects.
3. Update Modal `torah-tai-chi-env` secret.
4. Redeploy dashboard + website + Modal in parallel.
5. **Revoke** old key in Supabase only AFTER all three deploys are confirmed live.

### Kie/Seedance API key
Same pattern — Modal env update + redeploy.

### Anthropic / OpenRouter
Modal env update + redeploy. No dashboard impact.

---

## Daily/weekly health checks (manual until automated)

- [ ] **Once a day:** glance at Kie balance (it's surfaced in the dashboard sidebar via `KieLowBalanceBanner`). Top up before <$10.
- [ ] **Once a week:** scroll `/admin/events` for `error` events. Spike = investigate.
- [ ] **Once a week:** check Vercel cron history (`vercel.json` declares them) — confirm `reconcile-posts` and `purge-old-clips` ran successfully.
- [ ] **Once a quarter:** Supabase restore dry-run (see top of this doc).

---

## Useful one-liners

```bash
# Modal logs for the last hour, grepping a specific job
modal logs torah-tai-chi-pipeline --since 1h | grep <job_id>

# Re-deploy Modal worker
modal deploy modal_app.py

# Force re-fetch of latest parsha data without redeploy (dashboard)
# (from any server-action context)
revalidatePath('/videos/<slug>')

# Supabase: jobs stuck in flight
select id, parsha_id, kind, status, triggered_at,
       extract(epoch from (now() - triggered_at)) as age_sec
from jobs
where status in ('queued', 'running')
  and triggered_at < now() - interval '2 hours'
order by triggered_at;

# Cancel a stuck Kie task
# (no CLI — go to Kie dashboard, find task by ID from Modal logs, click Cancel)
```

---

## Last known good state

| Component | Version / commit | Notes |
|---|---|---|
| Dashboard | _track in PR description_ | Vercel project: `dashboard` |
| Website | _track in PR description_ | Vercel project: `website` |
| Modal worker | _check `modal app history`_ | App name: `torah-tai-chi-pipeline` |
| Supabase schema | latest migration in `dashboard/supabase/migrations/` | applied manually until [overhaul plan item Phase -1 #3](superpowers/plans/2026-06-03-stability-ux-perf-overhaul.md) lands |

---

## What goes in this runbook

✅ How to recover from a specific incident
✅ Deploy/rollback procedures
✅ Secret rotation sequencing
✅ Health-check checklists
✅ Useful queries / one-liners

❌ Architecture documentation (lives in CLAUDE.md / AGENTS.md)
❌ Feature plans (live in `docs/superpowers/plans/`)
❌ Audit findings (live in `tasks/*.output` and synthesized into plans)
