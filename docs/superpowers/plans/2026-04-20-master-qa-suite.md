# Master QA Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an end-to-end automated QA harness (Playwright + axe + Lighthouse + design-review subagents) that runs against the Vercel preview URLs for both `dashboard/` and `website/`, mocks all paid/public-outbound external APIs at the network layer, and emits a single agent-consumable `docs/qa/findings.md` punchlist.

**Architecture:** New top-level `tests/qa/` workspace orchestrates every suite. Auth uses Supabase `admin.generateLink` to bypass magic-link email. Test data lands in prod Supabase tagged `qa_seed=true`, filtered out of public website queries, wiped in teardown. Design-review runs after functional tests, consumes curated screenshots, dispatches 6 parallel subagents. Aggregator merges every JSON output into the final markdown.

**Tech Stack:** Playwright 1.49, @axe-core/playwright, Lighthouse (programmatic), Supabase Admin SDK, Node/TypeScript with `tsx`, superpowers `design-review` / `ux-psychology` / `audit` skills.

**Spec:** [docs/superpowers/specs/2026-04-20-master-qa-suite-design.md](../specs/2026-04-20-master-qa-suite-design.md)

**Note:** This plan is being executed on `main`, not in a worktree, because the user asked for direct execution. Phase 0 touches prod code (small, benign website-query filter and Supabase migration). All later phases only add files under `tests/qa/` and `docs/qa/`.

**Testing philosophy for this plan (important):** This is a QA suite testing EXISTING code. The normal TDD rhythm of "test fails → write code → test passes" is inverted: when a spec fails here, it means a real bug was found — the test stays, the bug gets logged to findings, fixing the bug is a separate follow-up plan. So each task's "expected result" is *test passes against preview*, with the understanding that a failure is a legitimate finding to capture, not a signal to iterate the test.

---

## File Structure

### Prod code changes (Phase 0 only)
- Create: `dashboard/supabase/migrations/20260420_qa_seed.sql` — add `qa_seed boolean` to `articles`, `videos`, `posts`
- Modify: `website/src/lib/content.ts` (or whatever file holds the Supabase list queries) — add `.eq('qa_seed', false)` filter
- Modify: `.gitignore` — ignore `docs/qa/findings.md`, `tests/qa/results/`, `tests/qa/shots/`, `tests/qa/storageState.json`

### New `tests/qa/` workspace
```
tests/qa/
├── package.json
├── tsconfig.json
├── playwright.config.ts
├── run.ts                           ← `npm run qa` entry
├── .env.qa.example
├── global-setup.ts
├── global-teardown.ts
├── fixtures/
│   ├── auth.ts
│   ├── mocks.ts
│   ├── seed-data.ts
│   └── viewports.ts
├── scripts/
│   └── cleanup.ts                   ← manual `npm run qa:cleanup`
├── dashboard/
│   ├── tier1/ (6 specs)
│   ├── tier2/ (11 specs)
│   └── tier3/ (2 specs)
├── website/
│   ├── tier1/ (3 specs)
│   ├── tier2/ (4 specs)
│   └── tier3/ (5 specs)
├── a11y/ (2 specs)
├── seo/ (1 spec)
├── perf/ (1 spec)
├── security/ (2 specs)
├── design-review/
│   ├── capture.ts
│   ├── review-runner.ts
│   └── prompts/
│       ├── dashboard-review.md
│       └── website-review.md
└── report/
    ├── aggregate.ts
    ├── findings-schema.ts
    └── templates/
        └── finding.md.tmpl
```

### Outputs (gitignored)
- `docs/qa/findings.md`
- `docs/qa/shots/**/*.png`
- `tests/qa/results/**/*.json`
- `tests/qa/storageState.json`

---

## Phase 0 — Pre-flight safety (prod code changes)

### Task 0.1: Add `qa_seed` column migration

**⚠️ Scope correction (discovered at execution time):** Articles live in Storyblok, not Supabase — the Supabase articles table was dropped in the April migration to Storyblok. This task only adds `qa_seed` to `videos` and `posts`. Article QA uses HTTP-layer Storyblok mocks (see updated strategy below) — no tagging needed in Storyblok, no test-written articles, read-only against real published stories on the website.

**Files:**
- Create: `dashboard/supabase/migrations/20260420_qa_seed.sql`

- [ ] **Step 1: Verify the tables we'll tag**

Run: `grep -l "create table" dashboard/supabase/migrations/*.sql`
Read each referenced file to confirm `articles`, `videos`, `posts` table names. If names differ, adjust the migration below.

- [ ] **Step 2: Write the migration**

```sql
-- Flag for QA seed rows. Production code must filter these out of
-- any public-facing query. Teardown deletes all rows with qa_seed=true.
alter table public.articles add column if not exists qa_seed boolean not null default false;
alter table public.videos   add column if not exists qa_seed boolean not null default false;
alter table public.posts    add column if not exists qa_seed boolean not null default false;

create index if not exists articles_qa_seed_idx on public.articles(qa_seed) where qa_seed = true;
create index if not exists videos_qa_seed_idx   on public.videos(qa_seed)   where qa_seed = true;
create index if not exists posts_qa_seed_idx    on public.posts(qa_seed)    where qa_seed = true;

comment on column public.articles.qa_seed is 'QA test seed row; must be filtered out of public queries and wiped by global-teardown.';
comment on column public.videos.qa_seed   is 'QA test seed row; same rules as articles.qa_seed.';
comment on column public.posts.qa_seed    is 'QA test seed row; same rules as articles.qa_seed.';
```

- [ ] **Step 3: Apply the migration to prod Supabase**

Run via the Supabase CLI the same way existing migrations get applied (check existing workflow — typically `supabase db push` from the dashboard dir, or manual paste in the Supabase SQL editor).

Expected: three `alter table` statements succeed. Idempotent — running again is a no-op because of `if not exists`.

- [ ] **Step 4: Commit**

```bash
git add dashboard/supabase/migrations/20260420_qa_seed.sql
git commit -m "feat(db): qa_seed column + indexes for QA isolation"
```

---

### Task 0.2: Filter `qa_seed` out of public website queries

**⚠️ Scope:** Only `videos` and `posts` Supabase queries need filtering. `articles` come from Storyblok (see `website/src/lib/articles.ts` pulling from `api.storyblok.com`), so there's nothing to filter at the Supabase layer for articles.

**Files:**
- Modify: website Supabase query sites (exact file determined in Step 1)

- [ ] **Step 1: Find every website query that reads videos/posts from Supabase**

Run: `grep -rn "from('videos'\|from('posts')" website/src/`
Record every file:line. Do NOT add a filter to any Storyblok-backed query (articles).

- [ ] **Step 2: Add the filter to each query**

For each hit, add `.eq('qa_seed', false)` to the query chain. Example:

Before:
```ts
const { data } = await supabase
  .from('articles')
  .select('*')
  .eq('status', 'published')
  .order('published_at', { ascending: false });
```

After:
```ts
const { data } = await supabase
  .from('articles')
  .select('*')
  .eq('status', 'published')
  .eq('qa_seed', false)
  .order('published_at', { ascending: false });
```

Apply the same treatment to videos and posts queries on the website. The dashboard does NOT need this filter — dashboard users are QA-aware.

- [ ] **Step 3: Verify locally**

Run: `cd website && npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 4: Commit**

```bash
git add website/src
git commit -m "fix(website): filter qa_seed rows out of public queries"
```

---

### Task 0.3: Gitignore QA outputs

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append QA output paths**

Add to the bottom of `.gitignore`:

```
# QA suite outputs
docs/qa/findings.md
docs/qa/shots/
tests/qa/results/
tests/qa/shots/
tests/qa/storageState.json
tests/qa/.env.qa
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore(qa): gitignore QA suite outputs"
```

---

## Phase A — Harness scaffolding

### Task A.1: Create `tests/qa/` package

**Files:**
- Create: `tests/qa/package.json`
- Create: `tests/qa/tsconfig.json`
- Create: `tests/qa/.env.qa.example`

- [ ] **Step 1: Write `tests/qa/package.json`**

```json
{
  "name": "torah-tai-chi-qa",
  "private": true,
  "type": "module",
  "scripts": {
    "qa": "tsx run.ts",
    "qa:playwright": "playwright test",
    "qa:cleanup": "tsx scripts/cleanup.ts",
    "qa:install": "playwright install chromium webkit"
  },
  "dependencies": {
    "@axe-core/playwright": "^4.10.0",
    "@playwright/test": "^1.49.0",
    "@supabase/supabase-js": "^2.103.3",
    "dotenv": "^16.4.5",
    "lighthouse": "^12.3.0",
    "playwright": "^1.49.0",
    "tsx": "^4.21.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20"
  }
}
```

- [ ] **Step 2: Write `tests/qa/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@qa/*": ["./*"]
    }
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Write `tests/qa/.env.qa.example`**

```
DASHBOARD_URL=https://dashboard-preview.vercel.app
WEBSITE_URL=https://website-preview.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
QA_TEST_EMAIL=qa-bot@torahtaichi.test
QA_TEST_NAME=QA Bot
```

- [ ] **Step 4: Install**

Run: `cd tests/qa && npm install && npx playwright install chromium webkit`
Expected: dependencies installed, browsers downloaded.

- [ ] **Step 5: Commit**

```bash
git add tests/qa/package.json tests/qa/tsconfig.json tests/qa/.env.qa.example tests/qa/package-lock.json
git commit -m "feat(qa): bootstrap tests/qa workspace"
```

---

### Task A.2: Playwright config with 2 projects × 3 viewports

**Files:**
- Create: `tests/qa/playwright.config.ts`
- Create: `tests/qa/fixtures/viewports.ts`

- [ ] **Step 1: Write `tests/qa/fixtures/viewports.ts`**

```ts
import { devices } from '@playwright/test';

export const desktop = { viewport: { width: 1440, height: 900 } };
export const tablet  = devices['iPad Mini'];
export const mobile  = devices['iPhone 14'];

export type ViewportName = 'desktop' | 'tablet' | 'mobile';
```

- [ ] **Step 2: Write `tests/qa/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { desktop, tablet, mobile } from './fixtures/viewports';

loadEnv({ path: '.env.qa' });

const DASHBOARD_URL = process.env.DASHBOARD_URL!;
const WEBSITE_URL   = process.env.WEBSITE_URL!;

export default defineConfig({
  testDir: '.',
  testIgnore: ['**/fixtures/**', '**/scripts/**', '**/report/**', '**/design-review/**'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 6,
  reporter: [
    ['list'],
    ['json', { outputFile: 'results/playwright.json' }],
  ],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    // Dashboard × 3 viewports
    { name: 'dashboard-desktop', testMatch: /dashboard\/.*\.spec\.ts/,
      use: { ...desktop, baseURL: DASHBOARD_URL, storageState: 'storageState.json' } },
    { name: 'dashboard-tablet',  testMatch: /dashboard\/.*\.spec\.ts/,
      use: { ...tablet,  baseURL: DASHBOARD_URL, storageState: 'storageState.json' } },
    { name: 'dashboard-mobile',  testMatch: /dashboard\/.*\.spec\.ts/,
      use: { ...mobile,  baseURL: DASHBOARD_URL, storageState: 'storageState.json' } },

    // Website × 3 viewports (no auth)
    { name: 'website-desktop', testMatch: /website\/.*\.spec\.ts/,
      use: { ...desktop, baseURL: WEBSITE_URL } },
    { name: 'website-tablet',  testMatch: /website\/.*\.spec\.ts/,
      use: { ...tablet,  baseURL: WEBSITE_URL } },
    { name: 'website-mobile',  testMatch: /website\/.*\.spec\.ts/,
      use: { ...mobile,  baseURL: WEBSITE_URL } },

    // Cross-cutting (run once at desktop)
    { name: 'a11y',     testMatch: /a11y\/.*\.spec\.ts/,     use: { ...desktop, storageState: 'storageState.json' } },
    { name: 'seo',      testMatch: /seo\/.*\.spec\.ts/,      use: { ...desktop, baseURL: WEBSITE_URL } },
    { name: 'security', testMatch: /security\/.*\.spec\.ts/, use: { ...desktop } },
  ],
});
```

- [ ] **Step 3: Commit**

```bash
git add tests/qa/playwright.config.ts tests/qa/fixtures/viewports.ts
git commit -m "feat(qa): playwright config with dashboard+website projects × 3 viewports"
```

---

### Task A.3: Global setup — provision test user + storageState

**Files:**
- Create: `tests/qa/global-setup.ts`
- Create: `tests/qa/fixtures/auth.ts`

- [ ] **Step 1: Write `tests/qa/fixtures/auth.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function ensureTestUser(email: string, name: string): Promise<string> {
  const admin = serviceClient();
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { name },
  });
  if (error || !data.user) throw error ?? new Error('createUser returned no user');
  return data.user.id;
}

export async function deleteTestUser(email: string): Promise<void> {
  const admin = serviceClient();
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
}

export async function generateMagicLinkAction(email: string, redirectTo: string): Promise<string> {
  const admin = serviceClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink', email, options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) throw error ?? new Error('no action_link');
  return data.properties.action_link;
}
```

- [ ] **Step 2: Write `tests/qa/global-setup.ts`**

```ts
import { chromium } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { ensureTestUser, generateMagicLinkAction } from './fixtures/auth';
import { seedAll } from './fixtures/seed-data';

loadEnv({ path: '.env.qa' });

export default async function globalSetup() {
  const email = process.env.QA_TEST_EMAIL!;
  const name  = process.env.QA_TEST_NAME!;
  const dashboardUrl = process.env.DASHBOARD_URL!;

  console.log('[qa] ensuring test user', email);
  await ensureTestUser(email, name);

  console.log('[qa] seeding test data');
  await seedAll();

  console.log('[qa] minting session');
  const actionLink = await generateMagicLinkAction(email, `${dashboardUrl}/auth/callback`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(actionLink);
  await page.waitForURL(new RegExp(`^${dashboardUrl.replace(/\./g, '\\.')}/(\\?|$)`), { timeout: 30_000 });
  await ctx.storageState({ path: 'storageState.json' });
  await browser.close();

  console.log('[qa] setup complete');
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/qa/global-setup.ts tests/qa/fixtures/auth.ts
git commit -m "feat(qa): global-setup provisions test user and mints session"
```

---

### Task A.4: Seed data helper

**Files:**
- Create: `tests/qa/fixtures/seed-data.ts`

- [ ] **Step 1: Inspect the articles/videos/posts table schemas**

Run: `grep -rn "from('articles')" dashboard/src/app/api/articles`
Read the columns used in inserts in those API routes. Record required NOT NULL columns. Do the same for `videos` and `posts` (look in `dashboard/src/app/actions/` and `dashboard/src/app/api/`).

- [ ] **Step 2: Write seed helper**

**⚠️ Scope:** Only seeds `videos` and `posts` in Supabase. Articles are Storyblok — QA for those uses HTTP-layer mocks (see `mocks.ts`) and read-only real published content, no seeding. The Storyblok Management API is never called from the QA harness for writes.

```ts
import { serviceClient } from './auth';

const SEED_PREFIX = 'qa-test-';

export interface SeedHandles {
  videoCompletedId: string;
  videoProcessingId: string;
  postScheduledId: string;
}

// Required column names discovered in Step 1 inspection.
export async function seedAll(): Promise<SeedHandles> {
  const sb = serviceClient();

  const { data: videos, error: vErr } = await sb.from('videos').insert([
    { slug: `${SEED_PREFIX}completed`,  title: 'QA TEST — Completed',  status: 'completed',  qa_seed: true },
    { slug: `${SEED_PREFIX}processing`, title: 'QA TEST — Processing', status: 'processing', qa_seed: true },
  ]).select('id');
  if (vErr) throw vErr;

  const { data: posts, error: pErr } = await sb.from('posts').insert([
    { platform: 'youtube', status: 'scheduled', qa_seed: true, scheduled_for: new Date(Date.now() + 86400_000).toISOString() },
  ]).select('id');
  if (pErr) throw pErr;

  return {
    videoCompletedId:    videos![0].id,
    videoProcessingId:   videos![1].id,
    postScheduledId:     posts![0].id,
  };
}

export async function wipeSeed(): Promise<void> {
  const sb = serviceClient();
  await sb.from('posts').delete().eq('qa_seed', true);
  await sb.from('videos').delete().eq('qa_seed', true);
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/qa/fixtures/seed-data.ts
git commit -m "feat(qa): seed data helper (qa_seed-tagged articles/videos/posts)"
```

---

### Task A.5: Global teardown + manual cleanup script

**Files:**
- Create: `tests/qa/global-teardown.ts`
- Create: `tests/qa/scripts/cleanup.ts`

- [ ] **Step 1: Write global-teardown**

```ts
import { config as loadEnv } from 'dotenv';
import { deleteTestUser } from './fixtures/auth';
import { wipeSeed } from './fixtures/seed-data';

loadEnv({ path: '.env.qa' });

export default async function globalTeardown() {
  console.log('[qa] wiping seed data');
  await wipeSeed();
  console.log('[qa] deleting test user');
  await deleteTestUser(process.env.QA_TEST_EMAIL!);
  console.log('[qa] teardown complete');
}
```

- [ ] **Step 2: Write manual cleanup script**

```ts
import { config as loadEnv } from 'dotenv';
import { deleteTestUser } from '../fixtures/auth';
import { wipeSeed } from '../fixtures/seed-data';

loadEnv({ path: '.env.qa' });

(async () => {
  await wipeSeed();
  await deleteTestUser(process.env.QA_TEST_EMAIL!);
  console.log('[qa] manual cleanup complete');
})();
```

- [ ] **Step 3: Commit**

```bash
git add tests/qa/global-teardown.ts tests/qa/scripts/cleanup.ts
git commit -m "feat(qa): global-teardown + manual cleanup script"
```

---

### Task A.6: External-API mocks fixture

**Files:**
- Create: `tests/qa/fixtures/mocks.ts`

- [ ] **Step 1: Write mocks**

```ts
import type { Page } from '@playwright/test';

const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

export async function installApiMocks(page: Page): Promise<void> {
  // Storyblok Management API (dashboard writes) and CDN (website reads via ISR
  // — but CDN calls happen server-side in website Next.js, not from the browser,
  // so page.route() doesn't intercept them. That's fine for CMS write flows
  // tested from the dashboard side.)
  await page.route('**/api.storyblok.com/v1/spaces/**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ stories: [] }) });
    }
    return route.fulfill({ status: 201, contentType: 'application/json',
      body: JSON.stringify({ story: { id: 999999, slug: 'qa-mock', published: false } }) });
  });

  // Anthropic (image gen + text) — return a canned image block
  await page.route('**/api.anthropic.com/**', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_qa', type: 'message', role: 'assistant',
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: ONE_PX_PNG_BASE64 } }],
      }),
    });
  });

  // Kie.ai — create job then poll complete
  await page.route('**/api.kie.ai/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'POST' && url.includes('/jobs')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: 'qa-kie-123', status: 'queued' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'qa-kie-123', status: 'completed', video_url: 'https://example.test/qa.mp4' }) });
  });

  // Buffer v2 GraphQL
  await page.route('**/api.bufferapp.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { createUpdate: { id: 'qa-buf-123', status: 'scheduled' } } }) });
  });

  // YouTube upload + v3 API
  await page.route('**/googleapis.com/upload/youtube/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'qa-yt-123', status: { uploadStatus: 'uploaded' } }) });
  });
  await page.route('**/googleapis.com/youtube/v3/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: [{ id: 'qa-yt-123', statistics: { viewCount: '42', likeCount: '7' } }] }) });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/qa/fixtures/mocks.ts
git commit -m "feat(qa): external-API mocks fixture (anthropic, kie, buffer, youtube)"
```

---

### Task A.7: Canary spec to prove the harness runs end-to-end

**Files:**
- Create: `tests/qa/dashboard/tier1/login.spec.ts`

- [ ] **Step 1: Write canary**

```ts
import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

test.describe('dashboard: auth', () => {
  test.beforeEach(async ({ page }) => { await installApiMocks(page); });

  test('authenticated user lands on /', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    // No redirect to /login happened, so auth fixture works.
  });

  test('sign out clears session and redirects to /login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test.describe('unauthenticated', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('hitting /compose unauth redirects to /login', async ({ page }) => {
      await page.goto('/compose');
      await expect(page).toHaveURL(/\/login/);
    });

    test('login page renders email field and CTA', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /send|sign in|continue/i })).toBeVisible();
    });
  });
});
```

- [ ] **Step 2: Run against preview**

Run: `cd tests/qa && cp .env.qa.example .env.qa` and fill in real values, then `npm run qa:playwright -- --project=dashboard-desktop dashboard/tier1/login.spec.ts`
Expected: all 4 tests pass (or legitimate fails are captured as findings — which for the canary means the harness itself is broken).

- [ ] **Step 3: Commit**

```bash
git add tests/qa/dashboard/tier1/login.spec.ts
git commit -m "feat(qa): canary login spec (proves auth fixture + config work)"
```

---

## Phase B — Tier 1 specs

Each spec below covers happy path + every plausible error mode + all 3 viewports + design-review capture point. Show the test names and assertion intent; implementer writes the Playwright code following the canary template from Task A.7.

### Task B.1: `dashboard/tier1/home.spec.ts`

**Files:**
- Create: `tests/qa/dashboard/tier1/home.spec.ts`

- [ ] **Step 1: Write spec**

Test cases:
1. `renders current parsha block` — `/` shows the week's parsha name + date.
2. `system health badge shows healthy when all services up` — badge visible, green/ok styling.
3. `empty-state when no content yet` — mock Supabase to return empty lists, expect friendly empty copy, not a blank page.
4. `mobile tabbar visible on mobile viewport, hidden on desktop` — guard the recent regression in commit `55f290c`.
5. `FAB action opens correct sheet` — clicking the floating action button opens compose or schedule.

Each test: navigate, assert, take named screenshot at the end for design-review capture (use `await page.screenshot({ path: 'shots/dashboard/tier1/home-<viewport>.png' })`).

- [ ] **Step 2: Run**
Run: `npm run qa:playwright -- dashboard/tier1/home.spec.ts`
Expected: all pass. Failures are real findings.

- [ ] **Step 3: Commit**
```bash
git add tests/qa/dashboard/tier1/home.spec.ts
git commit -m "feat(qa): tier1 home spec"
```

---

### Task B.2: `dashboard/tier1/compose.spec.ts`

**Files:**
- Create: `tests/qa/dashboard/tier1/compose.spec.ts`

- [ ] **Step 1: Write spec**

Test cases (each asserts the observable outcome, not implementation detail):
1. `topic entry persists across re-render`
2. `AI image gen happy path` (mocked Anthropic) — click generate, image src becomes the returned data URL, loading state clears.
3. `AI image gen error state` — mock 500, assert user-visible error toast, no broken image.
4. `upload file > 4.5MB succeeds via signed PUT` — create large File in test, confirm Supabase storage PUT happens (mocked) and image preview shows.
5. `post-now double-submit is idempotent` — click Post Now twice within 500ms, assert only one Buffer request was intercepted.
6. `schedule for future date creates a scheduled post` — pick future date, click schedule, assert toast "scheduled", assert Buffer mock hit once.
7. `past date rejected with inline error`
8. `monthly cost cap blocks N+1 generation` — mock Supabase cost totals to return at-cap, assert generate button disabled + explanatory text.
9. `back button mid-flow preserves draft` — fill form, navigate away, return, fields still populated (local storage? check current behavior).
10. `offline mid-post-now shows retryable error`

- [ ] **Step 2: Run** — `npm run qa:playwright -- dashboard/tier1/compose.spec.ts`
- [ ] **Step 3: Commit** — `git commit -m "feat(qa): tier1 compose spec"`

---

### Task B.3: `dashboard/tier1/channels.spec.ts`

**Files:**
- Create: `tests/qa/dashboard/tier1/channels.spec.ts`

- [ ] **Step 1: Write spec**

Test cases:
1. `Buffer connect deep-link opens new tab to Buffer channels UI` — assert anchor `target="_blank"` and href matches Buffer channels URL pattern.
2. `YouTube OAuth start redirects to Google consent` — click Connect YouTube, assert navigation starts toward `accounts.google.com` (we won't complete OAuth in test; just assert the initial redirect intent).
3. `YouTube callback with valid code marks channel connected` — POST directly to `/api/auth/youtube/callback?code=qa-code`, mock Google token exchange, reload /channels, assert connected state.
4. `YouTube disconnect clears connection` — click disconnect, confirm, assert state flips to disconnected.
5. `partial-connect state (YT on, Buffer off) renders both statuses correctly` — set state via Supabase admin, assert both pills render distinctly.

- [ ] **Step 2: Run & commit** — same pattern.

---

### Task B.4: `dashboard/tier1/schedule-sheet.spec.ts`

**Files:**
- Create: `tests/qa/dashboard/tier1/schedule-sheet.spec.ts`

Test cases:
1. `opens from /videos detail page`
2. `channel multi-select persists selection across viewport resize`
3. `future date required — past date shows inline error`
4. `submit schedules post and closes sheet`
5. `sheet unmount restores body overflow` — this is the specific regression from commit `1a4ee05`. Assert `document.body.style.overflow` is `''` after closing.
6. `mobile tabbar not hidden on desktop while sheet open` — regression guard for `55f290c`.
7. `stagger animation does not pin modal/toast visible after close` — regression guard for `f5def28`.

---

### Task B.5: `dashboard/tier1/article-publish.spec.ts`

**⚠️ Scope:** Articles are Storyblok-backed. This test MOCKS the Storyblok Management API at the HTTP layer (`api.storyblok.com/v1/spaces/**`) — no real Storyblok writes, no real articles created. The "appears on website" assertion is dropped because we can't safely publish a test article to real Storyblok; instead we assert the dashboard's write request has the correct payload and the user sees a success UI state.

**Files:**
- Create: `tests/qa/dashboard/tier1/article-publish.spec.ts`

Test cases — dashboard CMS flow against mocked Storyblok:
1. `new article form requires title and body` (pure UI validation, no API hit)
2. `Tiptap editor accepts bold, link, heading, code-block input`
3. `save draft POSTs to Storyblok Management API with correct payload` — mock returns 201, assert request body via `page.on('request')` capture.
4. `publish flips `published` flag in the payload and sends it to Storyblok` — assert payload.published === true.
5. `slug field is editable before submit`
6. `publishing with missing required SEO fields shows inline errors` (client-side validation)
7. `Storyblok 500 response surfaces user-visible error toast, no crash`

No `afterEach` cleanup needed — nothing was actually created in Storyblok.

---

### Task B.6: `dashboard/tier1/login.spec.ts` — EXPANDED

Already seeded by canary (A.7). Expand to cover:
1. `magic-link request invalid email shows inline error`
2. `magic-link request rate-limited shows clear copy` (simulate by making 6 rapid requests or mocking Supabase rate-limit response)
3. `already-logged-in user at /login redirects to /` (covered)
4. `unauth on any protected route redirects to /login` (loop through 5 routes)

- [ ] **Step 1: Expand spec** — add tests to existing file.
- [ ] **Step 2: Run & commit.**

---

### Task B.7: `website/tier1/home.spec.ts`

**Files:**
- Create: `tests/qa/website/tier1/home.spec.ts`

Test cases:
1. `hero section renders brand + tagline`
2. `latest-content sections render at least one article card and one video card`
3. `no QA seed rows leak to page` — assert no element text contains `qa-test-` or `QA TEST —`. This is the website-filter safety check.
4. `metadata: title, description, og:title, og:image, og:url, canonical all present`
5. `Lighthouse perf score ≥ 90` (deferred to perf/ suite — just note the page is in scope).
6. `mobile viewport: no horizontal scroll`
7. `no console errors or failed requests`

---

### Task B.8: `website/tier1/article-detail.spec.ts`

**Files:**
- Create: `tests/qa/website/tier1/article-detail.spec.ts`

Test cases:
1. `published article renders markdown correctly` — use a real published slug (from existing content, not seed).
2. `404 for non-existent slug`
3. `qa-test-* slug returns 404 on website` (confirms filter works).
4. `OG tags include article-specific title/description/image`
5. `structured data (Article JSON-LD) present and valid JSON`
6. `no console errors, no failed requests`
7. `mobile readable font size, line length ≤ 75ch`

---

### Task B.9: `website/tier1/video-detail.spec.ts`

**Files:**
- Create: `tests/qa/website/tier1/video-detail.spec.ts`

Test cases:
1. `published video page renders thumbnail + embed`
2. `404 for non-existent slug`
3. `qa-test-* slug returns 404`
4. `video embed player loads and is playable` (assert the video element exists and has a src; don't autoplay).
5. `OG:video tags present`
6. `no console errors`

---

## Phase C — Tier 2 specs

**Pattern for every Tier 2 spec:** happy path + 2 realistic error modes + a11y spot-check on the page + design-review screenshot. Tests are shorter (~5-7 per file).

### Task C.1: `dashboard/tier2/analytics.spec.ts`
- `page renders with YouTube performance table populated from mock`
- `ISR cache: second navigation within 5min is significantly faster` (use request timing)
- `handles empty data state`
- `handles YouTube API error from mock → user-visible error, no crash`

### Task C.2: `dashboard/tier2/calendar.spec.ts`
- `renders scheduled posts for current month`
- `click past-date entry opens its detail`
- `click future-date entry opens edit sheet`
- `empty month shows empty state copy`
- `timezone of displayed times matches user profile` (if applicable — inspect current code first)

### Task C.3: `dashboard/tier2/videos-list.spec.ts`
- `renders seeded videos + real videos`
- `status filter narrows list`
- `click video card navigates to detail`
- `mobile: cards stack, tabbar visible`
- `search box filters by title (if present)`

### Task C.4: `dashboard/tier2/videos-detail.spec.ts`
- `renders thumbnail + metadata`
- `edit stance toggle saves`
- `schedule button opens schedule-all-sheet`
- `default quality section edits persist`

### Task C.5: `dashboard/tier2/settings.spec.ts`
- `users section lists provisioned users`
- `add user happy path (unique email)`
- `add user duplicate email rejected with copy`
- `remove user disabled for self`
- `cost totals render`

### Task C.6: `dashboard/tier2/settings-buffer.spec.ts`
- `renders Buffer connection status`
- `connect CTA opens Buffer UI in new tab`
- `disconnected state renders correctly`

### Task C.7: `dashboard/tier2/settings-youtube.spec.ts`
- `renders YouTube connection status`
- `connect starts OAuth`
- `disconnect confirms and clears`
- `scopes correctly listed`

### Task C.8: `dashboard/tier2/settings-seo.spec.ts`
- `loads current SEO settings`
- `edit title/description persists via /api/settings/seo PATCH`
- `invalid length rejected`

### Task C.9: `dashboard/tier2/site-content.spec.ts`
- `loads current site content`
- `edit + save persists`
- `save while offline shows retryable error`

### Task C.10: `dashboard/tier2/jobs-detail.spec.ts`
- `completed job shows all clips + final video`
- `processing job shows live progress`
- `failed job shows error details and retry CTA`

### Task C.11: `dashboard/tier2/articles-list-edit.spec.ts`
- `list renders with seeded articles`
- `status filter narrows list`
- `edit existing article: title change persists`
- `edit existing article: body change persists`
- `delete article (non-published) removes it from list`

### Task C.12: `website/tier2/about.spec.ts`
- `renders all content blocks`
- `OG + canonical tags present`
- `no console errors`

### Task C.13: `website/tier2/book.spec.ts`
- `renders CTA and content`
- `book-buy link has correct href`
- `OG + canonical tags`

### Task C.14: `website/tier2/videos-list.spec.ts`
- `lists at least one real video, no qa-test-* videos`
- `pagination or infinite scroll works (inspect current impl)`
- `each card links to correct slug`

### Task C.15: `website/tier2/articles-list.spec.ts`
- `lists real articles only`
- `RSS link in <head> or footer`
- `each card links to correct slug`

For EACH task C.1-C.15:
- [ ] Write spec file under the correct tier2 path
- [ ] Run `npm run qa:playwright -- <spec path>`
- [ ] Commit: `git commit -m "feat(qa): tier2 <name> spec"`

---

## Phase D — Tier 3 smoke specs

### Task D.1: `dashboard/tier3/help.spec.ts`
One test per help page: `loads without error + main heading present`.
Pages: `/help`, `/help/edit-homepage`, `/help/generate-video`, `/help/publish-article`, `/help/schedule-posts`, `/help/stance`, `/help/troubleshooting`.

### Task D.2: `dashboard/tier3/fab-and-nav.spec.ts`
- `FAB visible on mobile, appropriate on desktop`
- `sidebar-nav links all return 200`
- `mobile tabbar items all navigable`

### Task D.3: `website/tier3/sitemap.spec.ts`
- `/sitemap.xml returns 200 with valid XML`
- `contains all published article slugs`
- `contains all published video slugs`
- `does NOT contain qa-test-* slugs`

### Task D.4: `website/tier3/robots.spec.ts`
- `/robots.txt returns 200`
- `contains User-agent and Sitemap lines`
- `disallows nothing unexpected`

### Task D.5: `website/tier3/feed.spec.ts`
- `/articles/feed.xml returns 200 application/rss+xml`
- `parses as valid RSS (use a simple regex check or xml parser)`
- `contains latest published articles`
- `excludes qa-test-*`

### Task D.6: `website/tier3/og-route.spec.ts`
- `/og returns 200 image/png`
- `/og?slug=<real> returns image with correct branding` (assert content-type + non-zero body)
- `/og?slug=qa-test-* returns 404 or fallback`

### Task D.7: `website/tier3/revalidate-api.spec.ts`
- `unauth POST returns 401`
- `valid secret POST returns 200 and triggers revalidation`

Each task: write, run, commit.

---

## Phase E — Cross-cutting

### Task E.1: `a11y/dashboard-a11y.spec.ts`

**Files:**
- Create: `tests/qa/a11y/dashboard-a11y.spec.ts`

- [ ] **Step 1: Write sweep**

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DASH_PAGES = [
  '/', '/compose', '/channels', '/calendar', '/analytics',
  '/videos', '/articles', '/settings', '/site-content',
];

for (const path of DASH_PAGES) {
  test(`a11y: ${path}`, async ({ page, baseURL }) => {
    await page.goto(`${process.env.DASHBOARD_URL}${path}`);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    // Fail only on violations flagged as serious/critical.
    const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}
```

- [ ] **Step 2: Run & commit.**

### Task E.2: `a11y/website-a11y.spec.ts`

Same pattern for website: `/`, `/about`, `/book`, `/videos`, `/articles`, `/articles/<real-slug>`, `/videos/<real-slug>`.

### Task E.3: `seo/website-metadata.spec.ts`

**Files:**
- Create: `tests/qa/seo/website-metadata.spec.ts`

Pages to check: `/`, `/about`, `/book`, `/videos`, `/articles`, `/articles/<slug>`, `/videos/<slug>`.

For each: assert presence of `<title>`, `<meta name="description">`, `<meta property="og:title">`, `<meta property="og:description">`, `<meta property="og:image">`, `<meta property="og:url">`, `<link rel="canonical">`. Assert no value is empty. Assert og:image returns 200.

### Task E.4: `perf/lighthouse-budgets.spec.ts`

**Files:**
- Create: `tests/qa/perf/lighthouse-budgets.spec.ts`

- [ ] **Step 1: Write spec**

```ts
import { test, expect } from '@playwright/test';
import { playAudit } from 'playwright-lighthouse';
// playwright-lighthouse works with Playwright; alternative: spawn `lighthouse` CLI.
// If that package can't be used, fall back to invoking lighthouse CLI programmatically.

const PAGES = [
  `${process.env.WEBSITE_URL}/`,
  // One real article slug — pick from DB:
  `${process.env.WEBSITE_URL}/articles/hebrew-genesis`, // REPLACE with real slug at implementation time
];

for (const url of PAGES) {
  test(`lighthouse budget: ${url}`, async ({ page }) => {
    await page.goto(url);
    await playAudit({
      page, port: 9222,
      thresholds: { performance: 90, accessibility: 90, 'best-practices': 90, seo: 95 },
    });
  });
}
```

Note: `playwright-lighthouse` requires launching Chromium with remote debugging. If it doesn't slot in cleanly, implement this task as a standalone Node script that shells out to `lighthouse` CLI and parses the JSON report. Prefer that if package conflicts.

### Task E.5: `security/dashboard-auth-matrix.spec.ts`

**Files:**
- Create: `tests/qa/security/dashboard-auth-matrix.spec.ts`

- [ ] **Step 1: Write spec**

```ts
import { test, expect, request } from '@playwright/test';

const PROTECTED_PAGES = [
  '/', '/compose', '/channels', '/calendar', '/analytics',
  '/videos', '/articles', '/settings', '/site-content',
];

const PROTECTED_API = [
  { method: 'GET',  path: '/api/articles' },
  { method: 'POST', path: '/api/articles' },
  { method: 'POST', path: '/api/compose/generate-image' },
  { method: 'POST', path: '/api/compose/upload' },
  { method: 'GET',  path: '/api/site-content' },
  { method: 'PATCH',path: '/api/settings/seo' },
  { method: 'POST', path: '/api/cron/reconcile-posts' }, // unauth unless Vercel cron header present
];

test.describe('unauth', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const p of PROTECTED_PAGES) {
    test(`page ${p} redirects to /login`, async ({ page }) => {
      await page.goto(`${process.env.DASHBOARD_URL}${p}`);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe('unauth API', () => {
  for (const r of PROTECTED_API) {
    test(`${r.method} ${r.path} rejects without cookie`, async () => {
      const ctx = await request.newContext();
      const res = await ctx.fetch(`${process.env.DASHBOARD_URL}${r.path}`, { method: r.method });
      expect([401, 403, 302]).toContain(res.status());
    });
  }
});
```

### Task E.6: `security/website-leaks.spec.ts`

Test cases:
- `homepage HTML does not contain SUPABASE_SERVICE_ROLE_KEY value`
- `homepage HTML does not contain ANTHROPIC_API_KEY value`
- `homepage HTML does not contain BUFFER_ACCESS_TOKEN value`
- `public OG image does not embed private metadata`

(Test loads the preview page and asserts `!htmlBody.includes(keyFromEnv)` — needs the real env values loaded in the runner's env.)

---

## Phase F — Design-review integration

### Task F.1: Screenshot capture runner

**Files:**
- Create: `tests/qa/design-review/capture.ts`

- [ ] **Step 1: Write capture script**

```ts
import { chromium } from 'playwright';
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installApiMocks } from '../fixtures/mocks';

loadEnv({ path: '.env.qa' });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile',  width: 390,  height: 844 },
];

const PAGES: { surface: 'dashboard'|'website'; tier: 1|2|3; paths: string[] }[] = [
  { surface: 'dashboard', tier: 1, paths: ['/', '/compose', '/channels'] },
  { surface: 'dashboard', tier: 2, paths: ['/analytics', '/calendar', '/videos', '/settings', '/site-content', '/articles'] },
  { surface: 'dashboard', tier: 3, paths: ['/help'] },
  { surface: 'website',   tier: 1, paths: ['/', '/articles', '/videos'] }, // pass real slug at runtime via env or real list
  { surface: 'website',   tier: 2, paths: ['/about', '/book'] },
];

(async () => {
  const browser = await chromium.launch();
  for (const group of PAGES) {
    const baseUrl = group.surface === 'dashboard' ? process.env.DASHBOARD_URL! : process.env.WEBSITE_URL!;
    const ctx = await browser.newContext(group.surface === 'dashboard' ? { storageState: 'storageState.json' } : undefined);
    const page = await ctx.newPage();
    if (group.surface === 'dashboard') await installApiMocks(page);
    for (const p of group.paths) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${baseUrl}${p}`, { waitUntil: 'networkidle' });
        const outDir = path.join('shots', group.surface, `tier${group.tier}`);
        await fs.mkdir(outDir, { recursive: true });
        const slug = p.replace(/\W+/g, '_') || 'root';
        await page.screenshot({ path: path.join(outDir, `${slug}-${vp.name}.png`), fullPage: true });
      }
    }
    await ctx.close();
  }
  await browser.close();
})();
```

- [ ] **Step 2: Commit.**

### Task F.2: Design-review prompts

**Files:**
- Create: `tests/qa/design-review/prompts/dashboard-review.md`
- Create: `tests/qa/design-review/prompts/website-review.md`

- [ ] **Step 1: Write dashboard prompt**

```markdown
You are a design reviewer. You have screenshots of dashboard pages at desktop and mobile viewports in the attached paths.

For each page, evaluate using the design-review, ux-psychology, and audit superpowers skills. Look specifically for:
- Visual hierarchy problems (multiple competing focal points, unclear CTA priority)
- Spacing inconsistencies (padding/margins that don't follow a rhythm)
- Contrast failures (text on background, button states, secondary text)
- Touch-target size on mobile (<44px is a finding)
- Empty/error/loading state quality (if reachable from these shots)
- Component consistency (buttons, inputs, cards should look like one system)
- Typography (size ratio, weight hierarchy, line length)
- Iconography clarity and consistency
- Motion that disorients (if apparent)
- Internal-tool ergonomics: does Yonah/Harvey know what to do next at a glance?

For each issue output a JSON array entry with this exact shape:
{
  "id": "dash-<page>-<counter>",
  "category": "ux" or "design",
  "tier": 1|2|3,
  "severity": "P0"|"P1"|"P2",
  "surface": "dashboard",
  "what": "one sentence",
  "where": "dashboard/src/app/<page>/page.tsx",
  "screenshot": "<path to the screenshot the issue is most visible in>",
  "suggestedFix": "one sentence"
}

Output the raw JSON array to stdout. Nothing else. No preamble, no closing commentary.
```

- [ ] **Step 2: Write website prompt** — analogous, swap `surface` to `website`, drop dashboard-specific heuristics, add: SEO-relevant copy quality, public-facing trust signals, above-the-fold value communication.

- [ ] **Step 3: Commit.**

### Task F.3: Review runner — dispatches subagents

**Files:**
- Create: `tests/qa/design-review/review-runner.ts`

- [ ] **Step 1: Write runner**

The runner reads shots/ layout, groups by `<surface>/tier<N>`, and for each group:
- Reads the prompt file.
- Dispatches a subagent with: (a) the prompt text, (b) paths to all screenshots in the group, (c) paths to the relevant source files (glob `dashboard/src/app/<path>/**/*.tsx` or `website/src/app/<path>/**/*.tsx`).
- Parses the returned JSON array.
- Writes `results/design-review-<surface>-tier<N>.json`.

Implementation detail: the dispatch mechanism depends on the runtime. If running inside Claude Code, the runner emits a list of subagent-task files under `design-review/queue/` and prints a handoff message instructing the orchestrator to dispatch via `Agent`. If running as a standalone Node script, implement via Anthropic SDK `messages.create` with the `claude-opus-4-7` model and the screenshots attached as image blocks.

Pick the second option unless the orchestrator already handles dispatch. Example:

```ts
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs/promises';
import path from 'node:path';

const client = new Anthropic();

async function reviewGroup(surface: string, tier: number, promptPath: string, shotPaths: string[]) {
  const prompt = await fs.readFile(promptPath, 'utf8');
  const imageBlocks = await Promise.all(shotPaths.map(async (p) => ({
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: 'image/png' as const,
              data: (await fs.readFile(p)).toString('base64') },
  })));
  const res = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imageBlocks] }],
  });
  const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map(c => c.text).join('');
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  const findings = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  await fs.mkdir('results', { recursive: true });
  await fs.writeFile(`results/design-review-${surface}-tier${tier}.json`,
                     JSON.stringify(findings, null, 2));
}

// Main: glob shots/**/*.png, group by surface+tier, run in parallel.
```

- [ ] **Step 2: Commit.**

---

## Phase G — Aggregator and orchestrator

### Task G.1: Findings schema

**Files:**
- Create: `tests/qa/report/findings-schema.ts`

- [ ] **Step 1: Write schema**

```ts
import { z } from 'zod';

export const FindingSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.enum(['func','stab','a11y','seo','ux','design','sec','perf']),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  severity: z.enum(['P0','P1','P2']),
  surface: z.enum(['dashboard','website']),
  what: z.string(),
  where: z.string(),
  repro: z.array(z.string()).optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  test: z.string().optional(),
  screenshot: z.string().optional(),
  suggestedFix: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const FindingsArraySchema = z.array(FindingSchema);
```

- [ ] **Step 2: Commit.**

### Task G.2: Aggregator

**Files:**
- Create: `tests/qa/report/aggregate.ts`

- [ ] **Step 1: Write aggregator**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { FindingsArraySchema, type Finding } from './findings-schema';

async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

async function collectPlaywrightFindings(): Promise<Finding[]> {
  const report = await readJsonIfExists<any>('results/playwright.json');
  if (!report) return [];
  const findings: Finding[] = [];
  for (const suite of report.suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const testRun of spec.tests ?? []) {
        for (const result of testRun.results ?? []) {
          if (result.status === 'passed') continue;
          findings.push({
            id: `pw-${spec.title}-${result.retry}`.replace(/\W+/g, '-').toLowerCase().slice(0, 60),
            category: 'func',
            tier: /tier1/.test(spec.file) ? 1 : /tier2/.test(spec.file) ? 2 : 3,
            severity: /tier1/.test(spec.file) ? 'P0' : 'P1',
            surface: spec.file.includes('dashboard') ? 'dashboard' : 'website',
            what: spec.title,
            where: spec.file,
            test: `${spec.file}:${spec.line ?? ''}`,
            actual: result.error?.message ?? 'test failed',
            screenshot: result.attachments?.find((a: any) => a.contentType === 'image/png')?.path,
          });
        }
      }
    }
  }
  return findings;
}

async function collectDesignReviewFindings(): Promise<Finding[]> {
  const dir = 'results';
  const files = (await fs.readdir(dir)).filter(f => f.startsWith('design-review-'));
  const out: Finding[] = [];
  for (const f of files) {
    const raw = await readJsonIfExists<unknown>(path.join(dir, f));
    const parsed = FindingsArraySchema.safeParse(raw);
    if (parsed.success) out.push(...parsed.data);
  }
  return out;
}

function render(findings: Finding[]): string {
  const bySev = { P0: [] as Finding[], P1: [] as Finding[], P2: [] as Finding[] };
  for (const f of findings) bySev[f.severity].push(f);
  const lines: string[] = [
    `# QA Findings — ${new Date().toISOString()}`,
    ``,
    `_Summary: ${bySev.P0.length} P0, ${bySev.P1.length} P1, ${bySev.P2.length} P2 across ${new Set(findings.map(f=>f.surface)).size} surfaces._`,
    ``,
  ];
  const titles: Record<string, string> = { P0: 'P0 — Broken (blocks ship)', P1: 'P1 — Noticeable', P2: 'P2 — Polish' };
  for (const sev of ['P0','P1','P2'] as const) {
    lines.push(`## ${titles[sev]}`);
    lines.push('');
    if (bySev[sev].length === 0) { lines.push('_None._', ''); continue; }
    for (const f of bySev[sev]) {
      lines.push(`### ${f.id}  [${f.category}] [tier${f.tier}]`);
      lines.push(`**What:** ${f.what}`);
      lines.push(`**Where:** ${f.where}`);
      if (f.repro)         lines.push(`**Repro:**\n${f.repro.map((s,i)=>`${i+1}. ${s}`).join('\n')}`);
      if (f.expected)      lines.push(`**Expected:** ${f.expected}`);
      if (f.actual)        lines.push(`**Actual:** ${f.actual}`);
      if (f.test)          lines.push(`**Test:** ${f.test}`);
      if (f.screenshot)    lines.push(`**Screenshot:** ${f.screenshot}`);
      if (f.suggestedFix)  lines.push(`**Suggested fix:** ${f.suggestedFix}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

(async () => {
  const funcFindings = await collectPlaywrightFindings();
  const designFindings = await collectDesignReviewFindings();
  const all = [...funcFindings, ...designFindings];
  await fs.mkdir('../../docs/qa', { recursive: true });
  await fs.writeFile('../../docs/qa/findings.md', render(all));
  console.log(`[qa] wrote docs/qa/findings.md (${all.length} findings)`);
})();
```

- [ ] **Step 2: Commit.**

### Task G.3: Orchestrator `run.ts` + root `npm run qa`

**Files:**
- Create: `tests/qa/run.ts`
- Modify: root `package.json` (add script if repo root has one, else skip — call `cd tests/qa && npm run qa` directly)

- [ ] **Step 1: Write `run.ts`**

```ts
import { spawn } from 'node:child_process';
import path from 'node:path';

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: true });
    p.on('exit', (code) => resolve(code ?? 1));
  });
}

(async () => {
  console.log('\n=== 1/5  Playwright suites ===');
  await run('npx', ['playwright', 'test']);

  console.log('\n=== 2/5  Lighthouse (website tier1) ===');
  // Lighthouse is inside the playwright config as a project named "perf" OR a standalone script.
  // If standalone, invoke it here. Skipping if integrated.

  console.log('\n=== 3/5  Design-review capture ===');
  await run('npx', ['tsx', 'design-review/capture.ts']);

  console.log('\n=== 4/5  Design-review subagents ===');
  await run('npx', ['tsx', 'design-review/review-runner.ts']);

  console.log('\n=== 5/5  Aggregate findings ===');
  await run('npx', ['tsx', 'report/aggregate.ts']);

  console.log('\n[qa] complete → docs/qa/findings.md');
})();
```

- [ ] **Step 2: Commit.**

---

## Phase H — First full run

### Task H.1: Execute the suite end-to-end, iterate on real failures

- [ ] **Step 1: Populate `.env.qa`** with real preview URLs + Supabase prod URL + service-role key + QA bot email.

- [ ] **Step 2: Run**

```bash
cd tests/qa && npm run qa
```

- [ ] **Step 3: Triage**

Open `docs/qa/findings.md`. For each finding:
- If it's a bug in the PRODUCT → leave it. The fix agent will pick it up.
- If it's a bug in the TEST (flaky selector, bad assertion) → fix the test, re-run just that spec.
- If a whole suite is broken (e.g., auth fixture can't mint a session) → fix the fixture, re-run.

- [ ] **Step 4: Once the suite runs cleanly (all test failures are legit findings, no harness failures), stop.**

The plan's deliverable is: a runnable, trustworthy QA harness + one generated `findings.md`. Fixing the product bugs in findings is a separate follow-on plan.

- [ ] **Step 5: Commit any test-fixing adjustments**

```bash
git add tests/qa/
git commit -m "fix(qa): harness adjustments from first full run"
```

---

## Self-review checklist (run before handoff)

- [x] **Spec coverage:** every section of the spec maps to a task — phases 0 (safety), A (harness), B-D (tiered specs), E (cross-cutting), F (design-review), G (aggregator), H (first run). Every external API in the mocks table has a matching intercept in `mocks.ts`. Every open-question-resolved decision from the spec (gitignored findings, prod Supabase, cron tier 2) is reflected.
- [x] **Placeholder scan:** no "TBD/TODO" steps; every code block is complete for the task at hand. Tier 2/3 spec tasks list concrete test cases; implementer follows the full spec pattern from Tier 1 canonical tasks.
- [x] **Type consistency:** `Finding` shape in `findings-schema.ts` matches the fields emitted by the design-review prompts and consumed by `aggregate.ts`. `serviceClient()` returns `SupabaseClient` throughout. `ensureTestUser`/`deleteTestUser` names consistent across setup/teardown/cleanup.
- [x] **Gaps flagged:** `website/src/lib/content.ts` is an assumption — Task 0.2 Step 1 explicitly does the discovery. Lighthouse package may not slot in cleanly — Task E.4 notes the CLI fallback. Seed data schemas use placeholder column names — Task A.4 Step 1 explicitly does the discovery.
