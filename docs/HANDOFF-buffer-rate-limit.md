# Handoff — Buffer rate-limit (drafts can't post; immediate 429)

_Created 2026-06-10. For a fresh session to pick up and fix properly._

## Symptom
Yonah opened the dashboard to post for the first time in ~a week and **immediately** got
"**Buffer is rate-limiting us — wait about a minute and tap Post again.**" — before posting
anything. This recurs despite a long history of caching/optimization fixes (see "Prior fixes").

## THE KEY FINDING (measured live 2026-06-10)
A single read-only Buffer GraphQL call (`{ account { organizations { id } } }`) with the prod
`BUFFER_ACCESS_TOKEN` returned:

```
HTTP 429
x-ratelimit-limit     = 100
x-ratelimit-remaining = 0
x-ratelimit-reset     = 1781121801   (unix; ~12h out)
retry-after           = 44481        (≈ 12.4 hours)
```

Interpretation:
- Buffer's cap on this token is **100 requests per day** (a hard, low ceiling — Buffer free/personal plan).
- The budget is **fully exhausted (remaining = 0)** and resets in **~12 hours**, not a minute.
- **Yonah was idle for a week, yet the budget is at 0.** So the 100/day is being consumed by
  **automated/background calls, not operator activity.** This is the real bug to chase.
- The in-app message ("wait about a minute") is **wrong/misleading** — waiting a minute does
  nothing; the daily window must reset (~12h). Fix the copy too (read `x-ratelimit-reset` and
  show the real reset time — the `buffer-health` cron already parses these headers).

**Reframe:** This is NOT "cache better on cold start." It's **"find and stop whatever is eating
~100 Buffer calls/day while the operator is idle."** Caching only matters in service of that.

## Where the error comes from
- Message string: `dashboard/src/lib/auto-post.ts:196-197`, triggered when the FIRST Buffer call
  of the post flow — `listProfiles(bufferToken)` at `auto-post.ts:187` — throws `HTTP 429`.
  So Buffer is already throttling before any post mutation runs.
- `withRetry` (auto-post.ts:62) deliberately does NOT retry on 429 (good — avoids amplifying).
- `gql()` in `dashboard/src/lib/buffer.ts:29` throws `Buffer GraphQL: HTTP 429` on a non-2xx.

## Buffer call sites (each is cached, but every cache MISS = one of the 100/day)
All hit `https://api.buffer.com/graphql` via `buffer.ts`:
- `lib/connected-platforms.ts:21` — `listProfiles` (shown on many pages → likely the top offender on page loads)
- `lib/auto-post.ts:187` — `listProfiles` (post flow; where the 429 surfaces)
- `app/compose/page.tsx:17` — `listProfiles`
- `app/channels/page.tsx:64` — `listProfilesFresh`-ish (`listProfiles`)
- `actions/broadcast.ts:57`, `actions/video-page/edit-posted.ts:139` — `listProfiles`
- `app/api/buffer/post-links/route.ts:26` + `lib/refresh-post-urls.ts:37` — `getPostExternalLinks`
  (→ internally calls `getOrgId` + a posts query = **2** Buffer calls per cold miss)
- Crons (`dashboard/vercel.json`): `buffer-health` daily 12:00 (1 call); `reconcile-posts` daily
  09:00 — **does NOT hit Buffer** (verified; uses YouTube + Supabase only); `purge-old-clips` 03:00.
  So crons are ~1 Buffer call/day — NOT the consumer.

## Caching today (`dashboard/src/lib/buffer.ts`)
- `listProfiles`, `getOrgId`: `unstable_cache` 24h. `getPostExternalLinks`: 1h.
- Plus a Supabase second-layer cache `buffer_profiles_cache` (migration `20260604_buffer_profiles_cache.sql`).
- **Architectural smell (line 225 `listProfilesWithFallback`):** it calls Buffer **first** and only
  falls back to the Supabase cache **on error**. So the Supabase "survives idle/deploys" cache does
  NOT prevent a Buffer hit on a cold `unstable_cache` — after a week the 24h cache is expired and
  every cold serverless instance re-hits Buffer live. On Vercel, `unstable_cache` is not reliably
  shared across serverless instances/cold starts, so sporadic traffic (Yonah's phone, prefetch,
  bots, uptime pings) can each trigger a live `listProfiles`/`getPostExternalLinks`. That is the
  most plausible way 100/day gets consumed with no operator activity.

## Leading hypotheses (ranked)
1. **Background/automated consumption of 100/day via ineffective cross-instance caching.** Pages
   that call `listProfiles`/`getPostExternalLinks` get hit by prefetch/bots/uptime/Yonah's phone;
   each cold Vercel instance misses `unstable_cache` and hits Buffer. Over a day this reaches 100.
   → Verify by counting Buffer calls (instrument `gql()`) and reviewing Vercel function logs for
   which routes call Buffer and how often.
2. **Supabase `buffer_profiles_cache` is empty or stale-not-read-first** (token_hash mismatch / RLS
   / never written), so it can neither prevent the cold Buffer hit nor absorb the 429.
   → Check the table for a row matching `tokenHash(BUFFER_ACCESS_TOKEN)` and its age.
3. **Something polls a Buffer-touching page or route on a schedule** (an external monitor, a
   webhook, a forgotten cron, Storyblok/Vercel preview pings). → Vercel logs.
100/day is so low that even modest automated traffic blows it; the fix must drive Buffer calls to
≈0 when idle.

## First diagnostics for the fresh session
1. **Re-read the live headers** (one call): GraphQL `{ account { organizations { id } } }` with
   `BUFFER_ACCESS_TOKEN` (in root `.env`), capture `x-ratelimit-*`. Confirms remaining + reset.
   (Today: remaining 0, resets ~12h.) The `buffer-health` cron route does this too.
2. **Vercel function logs** for the dashboard project (torah-tai-chi-admin): grep for the Buffer
   GraphQL host / the buffer.ts log lines / 429s — identify WHICH routes call Buffer and the
   per-day count. This is the decisive step — it names the consumer.
3. **Instrument `gql()`** (buffer.ts:29) to `console.log` every call with a stack/label, deploy,
   and watch the logs for a day (or replay) to see the call pattern + volume.
4. **Inspect Supabase `buffer_profiles_cache`** — is there a fresh row for the current token?
5. Confirm Buffer's documented limits for this token/plan (per-day vs per-minute) — verify, don't
   assume; the headers say 100/limit with a ~daily reset.

## Proposed fix direction (design in-session; don't just "add caching" again)
- **Supabase-cache-FIRST reads:** read `buffer_profiles_cache` first; serve it if younger than N
  hours; only hit Buffer when truly stale, via **single-flight/coalesced** refresh (and/or refresh
  in the daily `buffer-health` cron so it's always warm). This makes idle periods cost **0** Buffer
  calls and removes the cold-start stampede. (Invert today's "Buffer-first, Supabase-on-error".)
- **Don't re-fetch profiles at post time** (auto-post.ts:187) — use the cached set.
- **Single source for org id / profiles** shared across page-load call sites; dedupe concurrent calls.
- **Fix the operator copy:** show the real reset time from `x-ratelimit-reset` (not "wait a minute").
- **Consider the plan:** 100/day is tiny for a posting tool. Evaluate whether Yonah's Buffer plan
  needs upgrading, or whether the app can stay under 100/day with the above (it can, if idle = 0).

## Constraints / gotchas
- **`feedback_no_real_side_effects_in_qa`:** do NOT trigger real Buffer **posts** while testing.
  `listProfiles`/`getOrgId`/`getPostExternalLinks` are read-only (but still cost budget — and the
  budget is currently 0, so testing reads will 429 until reset ~12h). `createUpdate` posts for real.
- **`feedback_never_guess_always_verify`:** every prior Buffer bug was a wrong assumption; the
  headers above were measured, not assumed — keep measuring (Vercel logs, Buffer headers).
- Prior fixes already shipped — the gap is the background-consumption + Supabase-first inversion:
  - `3d5a796` cache profiles + readable 429; `36e81a1` cache getOrgId/getPostExternalLinks to 24h;
    `731007f`/`use-optimistic-save.ts` stop autosave keystrokes busting Buffer cache;
    `ad7ca9c`/`20260604_buffer_profiles_cache.sql` Supabase profile cache + daily health probe.
- Env: `BUFFER_ACCESS_TOKEN` (dashboard Vercel env + root `.env`); `CRON_SECRET` for cron routes.
- The dashboard is a heavily-customized Next.js — read `dashboard/node_modules/next/dist/docs/`
  before relying on `unstable_cache` / caching semantics.

## Immediate operator note
Buffer posting will **not** work until the daily window resets (~12 hours from the 2026-06-10
measurement) regardless of code — the 100/day budget is at 0. The fix prevents recurrence; it
can't restore today's budget.

## Key files
- `dashboard/src/lib/buffer.ts` — GraphQL client + all caching (the core).
- `dashboard/src/lib/auto-post.ts` — post flow; 429 message at :196.
- `dashboard/src/lib/connected-platforms.ts`, `refresh-post-urls.ts` — page-load Buffer callers.
- `dashboard/src/app/api/cron/buffer-health/route.ts` — reads `x-ratelimit-*` (diagnostic).
- `dashboard/src/app/api/buffer/post-links/route.ts`, `app/compose/page.tsx`, `app/channels/page.tsx`.
- `dashboard/supabase/migrations/20260604_buffer_profiles_cache.sql` — the Supabase cache table.
- `dashboard/vercel.json` — cron schedules.
