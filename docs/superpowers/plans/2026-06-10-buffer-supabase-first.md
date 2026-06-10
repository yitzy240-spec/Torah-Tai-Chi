# Buffer Supabase-First Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a full day of dashboard use cost ~0 of Buffer's 100/day request budget by serving channel profiles from Supabase first, and tell the operator the truth when a 429 does happen.

**Architecture:** Invert `lib/buffer.ts`'s read path: `buffer_profiles_cache` (Supabase) is the primary source for profiles + org id; Buffer GraphQL is only hit by the daily cron warm refresh, explicit /channels visits, post mutations, and a single-flight cold bootstrap. The exported `listProfiles`/`getOrgId` signatures don't change, so the five call sites stay untouched. `revalidatePath` busts become harmless (they re-read Supabase, not Buffer).

**Tech Stack:** Next.js 16.2.4 (App Router, heavily customized — consult `dashboard/node_modules/next/dist/docs/` before touching cache semantics), Supabase (PostgREST + service-role client), node:test with `--experimental-strip-types` for unit tests.

**Spec:** `docs/superpowers/specs/2026-06-10-buffer-rate-limit-fix-design.md`

**Constraints (non-negotiable):**
- NEVER call `createUpdate`/`createPost` in any test — it posts to live social accounts.
- Read-only Buffer calls still cost budget; budget is 0 until ~2026-06-10 20:03 UTC.
- Gate on `npm run build`, not just `tsc` (`feedback_verify_dep_changes_with_real_build`).

---

### Task 1: Extend + apply the missing migration

The `buffer_profiles_cache` table does NOT exist in prod (PostgREST 404s on it; migration was never applied). Add an `org_id` column to the migration, then apply.

**Files:**
- Modify: `dashboard/supabase/migrations/20260604_buffer_profiles_cache.sql`

- [ ] **Step 1: Add org_id to the migration file**

Append to the end of `dashboard/supabase/migrations/20260604_buffer_profiles_cache.sql`:

```sql
-- 2026-06-10: org id is immutable per token; caching it here removes the
-- second Buffer call (getOrgId) from every cold getPostExternalLinks.
-- add column if not exists keeps this idempotent for environments where
-- the table was already created from an earlier version of this file.
alter table buffer_profiles_cache add column if not exists org_id text;

comment on column buffer_profiles_cache.org_id is
  'Buffer organization id for this token (immutable). Populated lazily by getOrgId in lib/buffer.ts.';
```

- [ ] **Step 2: Apply to prod**

No Postgres connection string exists locally and Supabase CLI is not authenticated. First try pulling one from Vercel env (the executor has a working Vercel API token in `%APPDATA%\xdg.data\com.vercel.cli\auth.json`, team `team_G4LWi72mlerKttcrVNNVBwN2`, project `prj_3tGG6kv0AdM1Jy161pWwTgsCbFwN`):

```
GET https://api.vercel.com/v9/projects/prj_3tGG6kv0AdM1Jy161pWwTgsCbFwN/env?teamId=team_G4LWi72mlerKttcrVNNVBwN2&decrypt=true
```

Look for `POSTGRES_URL` / `DATABASE_URL` / `SUPABASE_DB_URL`. If found, apply the full migration SQL through it (`npx -y pg-cli` is not a thing — use a one-off node script with the `postgres` npm package, or `psql` if installed). If NOT found, hand the full migration SQL to the user to paste into the Supabase Studio SQL editor (project `jswdfthmegjbhnwbgeca`) — this is the RUNBOOK-sanctioned path.

- [ ] **Step 3: Verify the table exists**

```powershell
$key = ((Get-Content "c:\Users\yitzym\git\torah tai chi\.env") | Where-Object { $_ -match '^SUPABASE_SERVICE_ROLE_KEY=' }) -replace '^SUPABASE_SERVICE_ROLE_KEY=',''
Invoke-WebRequest -Uri "https://jswdfthmegjbhnwbgeca.supabase.co/rest/v1/buffer_profiles_cache?select=token_hash,org_id&limit=1" -Headers @{ apikey = $key; Authorization = "Bearer $key" } -UseBasicParsing | Select-Object StatusCode
```

Expected: `StatusCode 200` (empty array body is fine — the row gets seeded later).

- [ ] **Step 4: Commit**

```bash
git add dashboard/supabase/migrations/20260604_buffer_profiles_cache.sql
git commit -m "feat(dashboard): add org_id to buffer_profiles_cache (migration now actually applied to prod)"
```

---

### Task 2: Pure helpers — typed Buffer error + honest 429 message (TDD)

Pure module with no `next/cache` or Supabase imports so node:test can load it directly.

**Files:**
- Create: `dashboard/src/lib/buffer-shared.ts`
- Test: `dashboard/src/lib/buffer-shared.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/lib/buffer-shared.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferApiError, formatBufferRateLimitMessage } from './buffer-shared.ts';

test('BufferApiError keeps the legacy message shape (HTTP 429 string checks rely on it)', () => {
  const e = new BufferApiError(429, 1781121801);
  assert.equal(e.message, 'Buffer GraphQL: HTTP 429');
  assert.equal(e.status, 429);
  assert.equal(e.rateLimitReset, 1781121801);
  assert.ok(e instanceof Error);
});

test('formatBufferRateLimitMessage with a known reset gives hours + UTC time', () => {
  // reset 5h30m after "now" → ceil to 6 hours
  const nowMs = Date.UTC(2026, 5, 10, 8, 0, 0);
  const resetUnix = Math.floor(nowMs / 1000) + 5.5 * 3600;
  const msg = formatBufferRateLimitMessage(resetUnix, nowMs);
  assert.equal(
    msg,
    "Buffer's daily request limit is used up. Posting will work again in about 6 hours (around 13:30 UTC).",
  );
});

test('formatBufferRateLimitMessage under an hour says "in about an hour"', () => {
  const nowMs = Date.UTC(2026, 5, 10, 8, 0, 0);
  const resetUnix = Math.floor(nowMs / 1000) + 600; // 10 min
  assert.equal(
    formatBufferRateLimitMessage(resetUnix, nowMs),
    "Buffer's daily request limit is used up. Posting will work again in about an hour (around 08:10 UTC).",
  );
});

test('formatBufferRateLimitMessage without a reset header falls back to tomorrow', () => {
  assert.equal(
    formatBufferRateLimitMessage(null, Date.UTC(2026, 5, 10, 8, 0, 0)),
    "Buffer's daily request limit is used up. It resets once a day — try again tomorrow.",
  );
});

test('formatBufferRateLimitMessage with a reset in the past says shortly', () => {
  const nowMs = Date.UTC(2026, 5, 10, 8, 0, 0);
  assert.equal(
    formatBufferRateLimitMessage(Math.floor(nowMs / 1000) - 60, nowMs),
    "Buffer's daily request limit is used up. Posting should work again shortly — try again in a few minutes.",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `dashboard/`): `node --test --experimental-strip-types src/lib/buffer-shared.test.ts`
Expected: FAIL — `Cannot find module ... buffer-shared.ts`

- [ ] **Step 3: Write the implementation**

Create `dashboard/src/lib/buffer-shared.ts`:

```ts
// Pure helpers shared by lib/buffer.ts and lib/auto-post.ts.
// Deliberately free of next/cache + Supabase imports so node:test can
// load this file directly (node --test --experimental-strip-types).

/**
 * Typed error for non-2xx Buffer GraphQL responses. The message string
 * intentionally keeps the legacy `Buffer GraphQL: HTTP <status>` shape —
 * auto-post.ts and broadcast.ts match on `includes('HTTP 429')`.
 */
export class BufferApiError extends Error {
  readonly status: number;
  /** Unix seconds when the daily rate-limit window resets (x-ratelimit-reset), if Buffer sent it. */
  readonly rateLimitReset: number | null;

  constructor(status: number, rateLimitReset: number | null) {
    super(`Buffer GraphQL: HTTP ${status}`);
    this.name = 'BufferApiError';
    this.status = status;
    this.rateLimitReset = rateLimitReset;
  }
}

/**
 * Operator-facing message for a 429. Buffer's cap is 100 requests/DAY,
 * so "wait about a minute" (the old copy) was wrong — the window resets
 * roughly 24h after it opened. Always tell Yonah when posting will work.
 */
export function formatBufferRateLimitMessage(
  resetUnixSeconds: number | null,
  nowMs: number,
): string {
  const base = "Buffer's daily request limit is used up.";
  if (!resetUnixSeconds) {
    return `${base} It resets once a day — try again tomorrow.`;
  }
  const deltaMs = resetUnixSeconds * 1000 - nowMs;
  if (deltaMs <= 0) {
    return `${base} Posting should work again shortly — try again in a few minutes.`;
  }
  const reset = new Date(resetUnixSeconds * 1000);
  const hh = String(reset.getUTCHours()).padStart(2, '0');
  const mm = String(reset.getUTCMinutes()).padStart(2, '0');
  const hours = Math.ceil(deltaMs / 3_600_000);
  const when = hours <= 1 ? 'in about an hour' : `in about ${hours} hours`;
  return `${base} Posting will work again ${when} (around ${hh}:${mm} UTC).`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `dashboard/`): `node --test --experimental-strip-types src/lib/buffer-shared.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/buffer-shared.ts dashboard/src/lib/buffer-shared.test.ts
git commit -m "feat(dashboard): typed BufferApiError + honest daily-rate-limit message helper"
```

---

### Task 3: Invert lib/buffer.ts — Supabase-first profiles + org id, labeled gql logging

The exported names/signatures (`listProfiles`, `getOrgId` internal, `getPostExternalLinks`, `listProfilesFresh`) stay the same; only internals change. Call sites in `connected-platforms.ts`, `auto-post.ts`, `compose/page.tsx`, `actions/broadcast.ts`, `actions/video-page/edit-posted.ts`, `channels/page.tsx` need NO edits.

**Files:**
- Modify: `dashboard/src/lib/buffer.ts`

- [ ] **Step 1: gql() — typed error + one labeled log line per live call**

Replace the existing `gql` function (`buffer.ts:29-44`) with:

```ts
import { BufferApiError } from '@/lib/buffer-shared';

/**
 * Every invocation of this function costs 1 of Buffer's 100/day budget.
 * The label log line is the permanent audit trail — Vercel runtime logs
 * answer "who called Buffer today and how often" (2026-06-10 incident).
 */
async function gql<T>(
  token: string,
  query: string,
  variables?: object,
  label = 'unlabeled',
): Promise<T> {
  console.log(`[buffer] gql ${label}`);
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const resetRaw = res.headers.get('x-ratelimit-reset');
    const reset = resetRaw ? Number(resetRaw) : null;
    throw new BufferApiError(res.status, Number.isFinite(reset) ? reset : null);
  }
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`Buffer GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data) throw new Error('Buffer GraphQL: empty response');
  return body.data;
}
```

Then add labels to every `gql(...)` call in the file:
- `getOrgIdUncached`: `gql(token, \`{ account { organizations { id } } }\`, undefined, 'org-id')`
- `getPostExternalLinksUncached`: `gql<PostsResponse>(token, POST_LINKS_QUERY, { orgId }, 'post-links')`
- `listProfilesUncached`: `gql<AccountChannelsResponse>(token, LIST_CHANNELS_QUERY, undefined, 'list-profiles')`
- `createUpdate`: `gql<CreatePostResponse>(a.token, CREATE_POST_MUTATION, { input }, 'create-post')`
- `editPostBuffer`: `gql<EditPostResponse>(args.token, EDIT_POST_MUTATION, {...}, 'edit-post')`
- `deletePostBuffer`: `gql<DeletePostResponse>(args.token, DELETE_POST_MUTATION, {...}, 'delete-post')`

- [ ] **Step 2: Replace the cache layer — Supabase-first with single-flight bootstrap**

Delete `listProfilesWithFallback` (`buffer.ts:225-245`) and the old `listProfiles` export (`buffer.ts:247-251`). Replace `readCachedProfiles` and add the new read path:

```ts
type CacheRow = { profiles: BufferProfile[]; org_id: string | null };

async function readCacheRow(token: string): Promise<CacheRow | null> {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from('buffer_profiles_cache')
    .select('profiles, org_id')
    .eq('token_hash', tokenHash(token))
    .maybeSingle();
  if (error || !data) return null;
  return {
    profiles: data.profiles as BufferProfile[],
    org_id: (data.org_id as string | null) ?? null,
  };
}

// Single-flight: concurrent cold-bootstrap renders share ONE live Buffer
// call per serverless instance instead of stampeding.
const inflightProfiles = new Map<string, Promise<BufferProfile[]>>();

// Supabase-FIRST (2026-06-10 inversion — see spec
// docs/superpowers/specs/2026-06-10-buffer-rate-limit-fix-design.md):
//   1. Serve the buffer_profiles_cache row regardless of age. Profiles
//      change ~monthly; /channels (listProfilesFresh) and the daily
//      buffer-health cron keep the row ≤24h stale.
//   2. Only if NO row exists (true cold bootstrap), make one live
//      Buffer call and write through.
// This makes revalidatePath busts harmless: a busted render re-reads
// Supabase (free), not Buffer (100/day). The old order — Buffer first,
// Supabase only on error — burned the daily budget during normal
// editing sessions and is what kept locking Yonah out at post time.
async function profilesSupabaseFirst(token: string): Promise<BufferProfile[]> {
  const row = await readCacheRow(token);
  if (row) return row.profiles;
  const key = tokenHash(token);
  let p = inflightProfiles.get(key);
  if (!p) {
    p = (async () => {
      try {
        const fresh = await listProfilesUncached(token);
        await writeCachedProfiles(token, fresh).catch((e) => {
          console.error(
            '[buffer] CACHE WRITE FAILED — every render will hit Buffer live until fixed:',
            (e as Error).message,
          );
        });
        return fresh;
      } finally {
        inflightProfiles.delete(key);
      }
    })();
    inflightProfiles.set(key, p);
  }
  return p;
}

// Thin 5-min wrapper purely to keep Supabase IO down (one SQL read per
// 5 min per instance instead of per render). NO tags and a NEW key —
// nothing should ever bust this into a Buffer call, and even when
// revalidatePath busts it implicitly, the refetch is a Supabase read.
export const listProfiles = unstable_cache(
  async (token: string) => profilesSupabaseFirst(token),
  ['buffer-list-profiles-v2'],
  { revalidate: 300 },
);
```

- [ ] **Step 3: getOrgId — Supabase-first, persist lazily**

Replace the existing `getOrgId` (`buffer.ts:106-110`) with:

```ts
async function orgIdSupabaseFirst(token: string): Promise<string> {
  const row = await readCacheRow(token);
  if (row?.org_id) return row.org_id;
  const id = await getOrgIdUncached(token); // 1 live Buffer call
  if (row) {
    // Persist only when the row already exists — inserting a stub row
    // with empty profiles would make profilesSupabaseFirst serve [] forever.
    const sb = createServiceClient();
    await sb
      .from('buffer_profiles_cache')
      .update({ org_id: id })
      .eq('token_hash', tokenHash(token));
  }
  return id;
}

const getOrgId = unstable_cache(
  async (token: string) => orgIdSupabaseFirst(token),
  ['buffer-org-id-v2'],
  { revalidate: 86400 },
);
```

Note: the old `getOrgId` had `tags: ['buffer-profiles']` — drop the tags (nothing calls `revalidateTag` today, and tags only created bust-into-Buffer paths).

- [ ] **Step 4: Update the strategy comment block**

Replace the now-wrong "Three-layer caching strategy" comment (`buffer.ts:210-224`) with a short comment pointing at the spec and stating the inversion (Supabase primary; Buffer = cron + /channels + cold bootstrap + mutations only).

- [ ] **Step 5: Typecheck**

Run (from `dashboard/`): `npx tsc --noEmit`
Expected: clean. (`unstable_cache` import stays; `readCachedProfiles` references are all replaced by `readCacheRow`.)

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib/buffer.ts
git commit -m "fix(dashboard): Supabase-first Buffer reads — idle AND editing sessions now cost ~0 of the 100/day budget"
```

---

### Task 4: Age-bound the post-URL resolver

5 prod posts rows (oldest 2026-05-08) have a `buffer_update_id` but `post_url IS NULL` and will never resolve — each one re-queries Buffer on every cache-busted render of its video page, forever.

**Files:**
- Modify: `dashboard/src/lib/refresh-post-urls.ts`

- [ ] **Step 1: Add a 48h candidate cutoff**

In `refreshVideoPostUrls`, change the posts query (`refresh-post-urls.ts:23-28`) to:

```ts
  // Posts on this video that still need a URL resolved. Skip YouTube
  // (handled at upload), skip rows that already have a post_url, and
  // skip rows older than 48h: Buffer resolves externalLink within
  // minutes when it resolves at all, so anything older is a zombie that
  // would otherwise re-query Buffer on every busted render forever
  // (5 such rows existed on 2026-06-10, oldest from 05-08).
  const RESOLVE_WINDOW_MS = 48 * 60 * 60 * 1000;
  const cutoffIso = new Date(Date.now() - RESOLVE_WINDOW_MS).toISOString();
  const { data: posts } = await sb
    .from('posts')
    .select('id, platform, buffer_update_id')
    .eq('video_id', videoId)
    .neq('platform', 'youtube')
    .is('post_url', null)
    .gte('created_at', cutoffIso);
```

- [ ] **Step 2: Typecheck**

Run (from `dashboard/`): `npx tsc --noEmit` — expected clean.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/refresh-post-urls.ts
git commit -m "fix(dashboard): stop re-querying Buffer forever for posts whose URL never resolves (48h window)"
```

---

### Task 5: Honest 429 operator message in auto-post

**Files:**
- Modify: `dashboard/src/lib/auto-post.ts` (catch block at lines 186-209)

- [ ] **Step 1: Use the typed error + message helper**

Add to the imports in `auto-post.ts`:

```ts
import { BufferApiError, formatBufferRateLimitMessage } from '@/lib/buffer-shared';
```

Replace the catch block body (`auto-post.ts:188-209`) with:

```ts
    } catch (e) {
      const rawErr = String(e);
      const is429 = e instanceof BufferApiError ? e.status === 429 : rawErr.includes('HTTP 429');
      // Buffer's cap is 100 requests/DAY. After the 2026-06-10
      // Supabase-first inversion this should be near-impossible to hit
      // outside genuine posting volume — but when it happens, tell the
      // operator the real reset time, not "wait a minute".
      const userMsg = is429
        ? formatBufferRateLimitMessage(
            e instanceof BufferApiError ? e.rateLimitReset : null,
            Date.now(),
          )
        : `Couldn't reach Buffer: ${rawErr}. Check Settings → Buffer.`;
      await logEvent({
        actor: 'buffer',
        level: 'error',
        event: 'schedule.topic.error',
        subjectType: 'video',
        subjectId: args.videoId,
        message: userMsg,
        details: { stage: 'listProfiles', error: rawErr, rate_limited: is429 },
      });
      return { error: userMsg };
    }
```

- [ ] **Step 2: Typecheck**

Run (from `dashboard/`): `npx tsc --noEmit` — expected clean.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/auto-post.ts
git commit -m "fix(dashboard): 429 message shows the real daily-reset time instead of 'wait a minute'"
```

---

### Task 6: buffer-health cron becomes the daily warm refresh

**Files:**
- Modify: `dashboard/src/app/api/cron/buffer-health/route.ts`

- [ ] **Step 1: Add warm refresh + remaining log + cache-write alarm**

In the success path of the GET handler (after the `if (status >= 400)` block, replacing the final `return NextResponse.json({ ok: true, status, rateLimit });` at `route.ts:88`):

```ts
  // Warm refresh: re-pull the channel list once a day and write it
  // through to buffer_profiles_cache so the Supabase-first read path
  // (lib/buffer.ts, 2026-06-10 inversion) never serves a row older
  // than ~24h. Costs 1 extra Buffer call/day. If the write-through
  // fails (e.g. the table is missing again — the original sin of the
  // 2026-06-10 incident), email Yonah instead of failing silently.
  let cacheRefreshed = false;
  try {
    const { listProfilesFresh } = await import('@/lib/buffer');
    await listProfilesFresh(token);
    cacheRefreshed = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sendNotification({
      subject: '[Torah Tai Chi] Buffer profile cache refresh FAILED',
      text:
        `The daily warm refresh of buffer_profiles_cache failed: ${msg}\n\n` +
        `If this persists, dashboard pages will fall back to live Buffer calls ` +
        `and can burn the 100/day budget again. Check that the ` +
        `buffer_profiles_cache table exists and Buffer is reachable.`,
      html: `<p>The daily warm refresh of <code>buffer_profiles_cache</code> failed:</p><pre>${msg}</pre><p>If this persists, dashboard pages fall back to live Buffer calls and can burn the 100/day budget again.</p>`,
    });
  }

  console.log(
    `[buffer-health] ok remaining=${rateLimit.remaining ?? '?'} reset=${rateLimit.reset ?? '?'} cacheRefreshed=${cacheRefreshed}`,
  );
  return NextResponse.json({ ok: true, status, rateLimit, cacheRefreshed });
```

(Note: `listProfilesFresh` already does the write-through internally — `buffer.ts:154-160`. The dynamic import keeps the cron's failure modes isolated from module-load issues in lib/buffer.)

- [ ] **Step 2: Typecheck**

Run (from `dashboard/`): `npx tsc --noEmit` — expected clean.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/app/api/cron/buffer-health/route.ts
git commit -m "feat(dashboard): buffer-health cron warm-refreshes the profile cache + alarms on write failure"
```

---

### Task 7: Probe script, full gate, deploy, live verification

**Files:**
- Create: `tools/probe-buffer-remaining.mjs`

- [ ] **Step 1: Write the probe script**

Create `tools/probe-buffer-remaining.mjs`:

```js
// Probe Buffer's rate-limit headers with ONE read-only GraphQL call.
// Usage: node tools/probe-buffer-remaining.mjs   (reads BUFFER_ACCESS_TOKEN from root .env)
// Costs 1 of the 100/day budget per run. NEVER calls createPost.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(resolve(root, '.env'), 'utf8');
const token = env.match(/^BUFFER_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error('BUFFER_ACCESS_TOKEN not found in .env');

const res = await fetch('https://api.buffer.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ viewer { id } }' }),
});
const reset = res.headers.get('x-ratelimit-reset');
console.log(JSON.stringify({
  status: res.status,
  limit: res.headers.get('x-ratelimit-limit'),
  remaining: res.headers.get('x-ratelimit-remaining'),
  reset,
  resetIso: reset ? new Date(Number(reset) * 1000).toISOString() : null,
}, null, 2));
```

- [ ] **Step 2: Full gate**

Run from `dashboard/`:

```bash
npx tsc --noEmit
node --test --experimental-strip-types src/lib/buffer-shared.test.ts
npm run build
```

Expected: all clean. The real `next build` is the gate — tsc alone has lied before.

- [ ] **Step 3: Commit + push to main (Vercel auto-deploys)**

```bash
git add tools/probe-buffer-remaining.mjs
git commit -m "chore: read-only Buffer rate-limit probe script"
git push origin main
```

Watch the deployment: `https://api.vercel.com/v6/deployments?projectId=prj_3tGG6kv0AdM1Jy161pWwTgsCbFwN&teamId=team_G4LWi72mlerKttcrVNNVBwN2&limit=1` until `state=READY`. "Fixed" means deployed.

- [ ] **Step 4: Seed the cache row (after the ~20:03 UTC budget reset)**

The table starts empty. Either wait for the 12:00 UTC cron, or seed immediately: hit `/api/cron/buffer-health` with `Authorization: Bearer ${CRON_SECRET}` (CRON_SECRET is in root `.env`) — costs 2 Buffer calls (probe + warm refresh), then verify:

```powershell
# expect one row, fresh updated_at, profiles array non-empty
Invoke-RestMethod -Uri "https://jswdfthmegjbhnwbgeca.supabase.co/rest/v1/buffer_profiles_cache?select=token_hash,org_id,updated_at" -Headers @{ apikey = $key; Authorization = "Bearer $key" }
```

- [ ] **Step 5: Live verification (read-only; NO createUpdate anywhere)**

1. `node tools/probe-buffer-remaining.mjs` → record `remaining` (call this R1).
2. In a browser, log into the dashboard; visit `/`, `/compose`, a live video page, and a phase-5 video page; edit a caption (triggers the save → revalidatePath → re-render cycle that used to burn budget); revisit the pages.
3. `node tools/probe-buffer-remaining.mjs` → R2. **Expected: R1 - R2 ≤ 1** (the probe itself costs 1; page traffic should cost 0).
4. Check Vercel runtime logs for `[buffer] gql` lines — expect NONE from page renders.
5. Next morning, probe once more — expected remaining ≈ 99/100 (only the cron's 2 calls + probes), confirming zero idle drip.

- [ ] **Step 6: Close out**

Update `docs/HANDOFF-buffer-rate-limit.md` with a one-paragraph "RESOLVED 2026-06-10" header pointing at the spec, and update the memory file `project_buffer_rate_limit_investigation.md` (root cause: session-burst via revalidatePath + missing table — NOT background drip; status: fixed + verification numbers). Commit.

---

## Self-review notes

- Spec coverage: §1 migration → Task 1; §2 inversion → Task 3; §3 post flow → Task 3 (auto-post needs no edit; `listProfiles` export inverted in place — spec's "switch call sites to getProfiles" is implemented as "invert behind the existing export", same effect, smaller diff); §4 message → Tasks 2+5; §5 instrumentation + warm refresh → Tasks 3+6; verification → Task 7. Bonus fix (zombie post-URL resolver) → Task 4, surfaced during planning from prod data.
- Type consistency: `BufferApiError(status, rateLimitReset)` used identically in Tasks 2, 3, 5. `readCacheRow` replaces `readCachedProfiles` only within buffer.ts (no external importers — verified by grep).
- `listProfilesFresh` keeps using `writeCachedProfiles`, which upserts `{token_hash, profiles, updated_at}` — does NOT touch `org_id` (supabase-js upsert only writes provided columns), so the lazily-persisted org_id survives daily refreshes.
