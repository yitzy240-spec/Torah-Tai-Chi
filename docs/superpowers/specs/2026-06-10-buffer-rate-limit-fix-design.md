# Buffer rate-limit fix — Supabase-first profile reads

_Design approved 2026-06-10 (Yitzy). Supersedes the framing in `docs/HANDOFF-buffer-rate-limit.md`._

## Problem

Buffer caps our token at **100 GraphQL requests/day** (measured live 2026-06-10:
`x-ratelimit-limit=100`, ~24h window). Yonah keeps hitting 429 at posting time
(2026-06-02, 06-03, 06-09) and the app tells him to "wait about a minute" when the
real lockout is until the next daily reset.

## Root cause (verified, not assumed)

**There is no idle/background consumer.** The budget is burned in bursts during
Yonah's own work sessions:

1. **Every save action busts the Buffer cache.** `save-platform-caption`,
   `save-script`, `save-social-metadata`, `save-site-fields`, etc. call
   `revalidatePath('/videos/{slug}')` per (debounced) save. Per Next 16.2.4 docs
   (`node_modules/next/dist/docs/.../revalidatePath.md`), the next render of that
   path then re-executes every `unstable_cache` entry it uses — so each save makes
   the page re-hit Buffer live (`listProfiles`, plus `getOrgId` + posts query on
   live pages). ~3 saves per caption edit × an evening of editing ≈ 100 calls.
   The 2026-06-04 keystroke-debounce fix reduced the frequency but not the mechanism.
2. **The Supabase fallback cache never worked.** The `buffer_profiles_cache` table
   from migration `20260604_buffer_profiles_cache.sql` **was never applied to prod**
   (PostgREST returns 404 for it; `videos`/`oauth_tokens` return 200). Every
   write-through has failed silently; the 429 → serve-stale fallback in
   `buffer.ts:listProfilesWithFallback` has never returned a cached row.

Evidence: `execution_events` timeline shows all 429s mid-session (Jun 9: active
19:02–20:41 UTC, 429s 20:32–20:36); rate-window reset (Jun 10 20:03 UTC) is ~24h
after that session; middleware 307s all unauthenticated traffic before any
Buffer-calling code; CI uses placeholder env; crons cost ~1 call/day; live runtime
log tails show zero requests while idle.

## Design (approved: "full inversion", Approach A)

Flip the read path: our database is the primary source for profiles; Buffer is
only consulted on a daily warm refresh, an explicit /channels visit, or a
cold-bootstrap when no cached row exists.

### 1. Apply the missing migration, extended
- Add `org_id text` column to the `buffer_profiles_cache` schema (org id is
  immutable per token; caching it removes the `getOrgId` Buffer call from
  `getPostExternalLinks`).
- Apply idempotently to prod Supabase (table currently absent, so this is CREATE).

### 2. Supabase-first reads in `dashboard/src/lib/buffer.ts`
- New `getProfiles(token)`: read `buffer_profiles_cache` row → serve regardless of
  age (profiles change ~monthly; cron + /channels keep it ≤24h stale) → if **no
  row**, single-flight live `listProfiles` + write-through (in-process promise
  dedupe; per-instance is acceptable).
- Wrap the Supabase read in a short `unstable_cache` (~5 min, **no tags**) purely
  to limit Supabase IO; a `revalidatePath` bust now re-reads Supabase, not Buffer.
- All `listProfiles` call sites switch to `getProfiles`: `connected-platforms.ts`,
  `auto-post.ts:187`, `compose/page.tsx`, `actions/broadcast.ts`,
  `actions/video-page/edit-posted.ts`.
- `/channels` keeps `listProfilesFresh` (explicit operator refresh, write-through
  already in place — now actually persisting).
- `getOrgId` reads cached `org_id` first; live fetch + write-through only when missing.

### 3. Post flow stops re-fetching
- `auto-post.ts` uses `getProfiles()`; Buffer budget at post time is spent only on
  `createPost` mutations (~1 per platform).

### 4. Honest 429 operator message
- `gql()` throws a typed error carrying `status` and `x-ratelimit-reset`.
- auto-post catch formats: "Buffer's daily request limit is used up. Posting will
  work again after <time> (about N hours from now)." — replaces "wait about a minute".

### 5. Instrumentation + warm refresh
- `gql()` logs one labeled line per live Buffer call:
  `[buffer] gql <operation> from=<call-site>` → Vercel logs answer "who called
  Buffer today" permanently.
- `buffer-health` cron (daily 12:00 UTC) additionally write-throughs the profile
  cache (its probe becomes the warm refresh) and logs `x-ratelimit-remaining`.

## Out of scope (deliberate)
- The save actions' `revalidatePath` calls (needed for page freshness; harmless
  after inversion).
- The compose 5s post-links poller (bounded at 3 min; now ≤1 posts-query/hour).
- Buffer plan upgrade decision.
- Migrating to Next 16 `use cache` directives (rejected: large blast radius,
  no additional benefit here).

## Verification (no real posts — `feedback_no_real_side_effects_in_qa`)
- Unit-test the read path with table row present / absent / Supabase error.
- Real `next build` gate (not just tsc) per `feedback_verify_dep_changes_with_real_build`.
- Post-deploy, after the 2026-06-10 20:03 UTC reset: probe `remaining` (1 read
  call), exercise dashboard pages + a caption-save bust cycle, probe again —
  expected drop ≈ 0. Overnight idle probe should show no drip.
- Never call `createUpdate` in testing.

## Success criteria
- A full day of dashboard browsing/editing consumes ~0 of the 100/day budget.
- Posting a video consumes ~1 call per platform.
- If 429 ever recurs, the operator message states the actual reset time.
- Vercel logs show a labeled line for every live Buffer call.
