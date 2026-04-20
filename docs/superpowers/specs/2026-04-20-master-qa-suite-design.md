# Master QA Suite — Design Spec

**Date:** 2026-04-20
**Scope:** Full UX/UI + stability QA of the Torah Tai Chi dashboard (`dashboard/`) and public website (`website/`), executed end-to-end by an automated Playwright suite with an integrated design-review pass, producing an agent-consumable `findings.md` that drives subsequent fix work.

---

## 1. Problem

We have two Next.js 16 apps shipping to production (dashboard preview + public website) with no systematic QA. Recent commits show real UX regressions have been landing and getting caught only after manual poking (mobile tabbar hiding on desktop, stance sheet scroll-locking the page, ISR cache-key staleness). End-users Yonah and Harvey are non-technical — anything half-broken on their side becomes our support load. We need one repeatable pass that catches functional, stability, UX, accessibility, SEO, performance, and security issues before each milestone, and emits output a follow-on fix agent can work directly from.

## 2. Outcome

A single command (`npm run qa` at repo root) that:

1. Spins up Playwright against the **Vercel preview URLs** for both apps.
2. Authenticates via a bootstrapped test user (`qa-bot@torahtaichi.test`) using Supabase's `admin.generateLink` to bypass the email magic-link without touching prod UI.
3. Runs ~165 tests across Chromium desktop + Mobile WebKit + tablet, tiered by user impact.
4. Runs axe-core a11y, metadata/SEO validation, Lighthouse budgets (public pages only), unauth/leak security checks.
5. Captures clean screenshots and dispatches a design-review subagent pass (using the `design-review`, `ux-psychology`, and `audit` superpowers skills) across every page.
6. Aggregates everything into `docs/qa/findings.md` — a structured, agent-parseable punchlist tagged by severity (P0/P1/P2) and category (`func`/`stab`/`a11y`/`seo`/`ux`/`design`/`sec`/`perf`), with per-finding repro steps, file references, the test that proves the bug, a screenshot, and a suggested fix direction.
7. Leaves the environment clean (test user + seed data removed).

No prod code is modified to support testing; no real external API calls are made; no real Buffer posts or YouTube uploads happen.

## 3. Non-goals

- Load/stress testing.
- Visual regression with committed baselines (deferred to Phase 2 — baselines churn too fast during active design work).
- Firefox coverage (Chromium + Mobile WebKit only).
- Email deliverability of the real magic-link send (bypassed entirely).
- Analytics/tracking pixel QA (not installed yet).
- Real-API integration tests against Kie.ai / Anthropic / Buffer / YouTube — a small hand-run smoke suite will exist separately but is NOT part of this automated run.
- Modifying prod code to add `QA_DRY_RUN` flags or similar. All mocking is done at the network layer from the test side.

## 4. Architecture

### 4.1 Layout

New top-level `tests/qa/` directory. Does not live inside either app — shared harness for both.

```
tests/qa/
├── package.json                  ← its own deps (playwright, axe-core, lighthouse, tsx)
├── playwright.config.ts
├── global-setup.ts               ← provision test user, seed data
├── global-teardown.ts            ← wipe test user + seed
├── fixtures/
│   ├── auth.ts                   ← storageState-producing fixture
│   ├── mocks.ts                  ← installApiMocks(page)
│   ├── seed-data.ts              ← articles/videos/posts inserted in dev Supabase
│   └── viewports.ts              ← desktop / tablet / mobile presets
├── dashboard/
│   ├── tier1/
│   │   ├── login.spec.ts
│   │   ├── home.spec.ts
│   │   ├── compose.spec.ts
│   │   ├── channels.spec.ts
│   │   ├── schedule-sheet.spec.ts
│   │   └── article-publish.spec.ts
│   ├── tier2/
│   │   ├── analytics.spec.ts
│   │   ├── calendar.spec.ts
│   │   ├── videos-list.spec.ts
│   │   ├── videos-detail.spec.ts
│   │   ├── settings.spec.ts
│   │   ├── settings-buffer.spec.ts
│   │   ├── settings-youtube.spec.ts
│   │   ├── settings-seo.spec.ts
│   │   ├── site-content.spec.ts
│   │   ├── jobs-detail.spec.ts
│   │   └── articles-list-edit.spec.ts
│   └── tier3/
│       ├── help.spec.ts
│       └── fab-and-nav.spec.ts
├── website/
│   ├── tier1/
│   │   ├── home.spec.ts
│   │   ├── article-detail.spec.ts
│   │   └── video-detail.spec.ts
│   ├── tier2/
│   │   ├── about.spec.ts
│   │   ├── book.spec.ts
│   │   ├── videos-list.spec.ts
│   │   └── articles-list.spec.ts
│   └── tier3/
│       ├── sitemap.spec.ts
│       ├── robots.spec.ts
│       ├── feed.spec.ts
│       ├── og-route.spec.ts
│       └── revalidate-api.spec.ts
├── a11y/                         ← axe-core sweeps
│   ├── dashboard-a11y.spec.ts
│   └── website-a11y.spec.ts
├── seo/
│   └── website-metadata.spec.ts
├── perf/
│   └── lighthouse-budgets.spec.ts
├── security/
│   ├── dashboard-auth-matrix.spec.ts
│   └── website-leaks.spec.ts
├── design-review/
│   ├── capture.ts                ← runs after functional suite, takes curated shots
│   ├── review-runner.ts          ← dispatches design-review subagents in parallel
│   └── prompts/
│       ├── dashboard-review.md
│       └── website-review.md
├── report/
│   ├── aggregate.ts              ← builds findings.md
│   └── templates/
│       └── finding.md.tmpl
└── shots/                        ← per-run screenshot output (gitignored)
```

### 4.2 Tooling

- **Playwright 1.49+** — Chromium (desktop 1440×900), Mobile WebKit (iPhone 14, 390×844), tablet WebKit (iPad Mini, 768×1024).
- **`@axe-core/playwright`** — a11y scans.
- **Lighthouse CI (programmatic)** — perf budgets: LCP < 2.5s, CLS < 0.1, TBT < 200ms, performance score ≥ 90.
- **Node script for aggregation** — reads Playwright JSON reporter output + design-review JSON output → `findings.md`.
- **`tsx`** for running TS scripts directly.

### 4.3 Data flow

```
global-setup
  ├─ create qa-bot@torahtaichi.test via admin.createUser
  ├─ admin.generateLink({type:'magiclink'}) → navigate → storageState.json
  └─ insert seed rows (articles/videos/scheduled posts, all tagged qa_seed=true)

playwright run (parallel workers, each loads storageState + installs mocks)
  ├─ dashboard/*  → *.json results
  ├─ website/*    → *.json results
  ├─ a11y/*       → axe violations JSON
  ├─ seo/*        → metadata assertions
  ├─ perf/*       → lighthouse budget JSON
  └─ security/*   → auth-matrix JSON

design-review/capture → shots/**/*.png

design-review/review-runner
  ├─ dispatch 6 subagents in parallel (dashboard tier1/tier2/tier3, website tier1/tier2/tier3)
  ├─ each consumes the shots for its tier + page source/notes
  └─ emits design-review-<tier>-<surface>.json

report/aggregate
  ├─ ingest all JSON outputs
  ├─ dedupe, classify severity/category
  └─ write docs/qa/findings.md + docs/qa/shots/ (copied from tests/qa/shots)

global-teardown
  └─ admin.deleteUser + delete seed rows
```

### 4.4 Authentication

Magic-link–only login means the usual UI flow requires email inbox access. Solution, entirely test-side:

```ts
// fixtures/auth.ts (sketch)
export const test = base.extend({
  storageState: async ({}, use) => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: 'qa-bot@torahtaichi.test',
      options: { redirectTo: `${DASHBOARD_URL}/auth/callback` },
    });
    // data.properties.action_link is a direct Supabase verify URL
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(data.properties.action_link);
    await page.waitForURL(`${DASHBOARD_URL}/`);
    const state = await ctx.storageState();
    await use(state);
  },
});
```

Reused across all dashboard tests. Website tests don't need auth.

### 4.5 External-call mocking

`fixtures/mocks.ts` installs `page.route()` intercepts. Mock surface:

| Upstream pattern | Test returns |
|---|---|
| `POST api.anthropic.com/v1/messages` | `{ content: [{ type:'image', source:{ data: <1x1 PNG base64> } }] }` |
| `POST api.kie.ai/v1/jobs` | `{ id: 'qa-job-123' }` |
| `GET api.kie.ai/v1/jobs/qa-job-123` | `{ status:'completed', video_url:'https://example.test/fake.mp4' }` |
| `POST api.bufferapp.com/2/graphql` | `{ data: { createUpdate: { id: 'qa-buf-123' } } }` |
| `POST googleapis.com/upload/youtube/**` | `{ id: 'qa-yt-123' }` |
| `GET googleapis.com/youtube/v3/**` | fixture stats payload |
| Supabase storage upload PUT | passthrough (dev-env bucket is fine) |

No prod code is modified. If a test needs to verify error handling, the mock returns 4xx/5xx for that test only.

### 4.6 Test data

Global setup inserts, in dev-preview Supabase:

- 3 articles: one `draft`, one `published` (dated), one `scheduled` (future).
- 2 videos: one `completed`, one `processing`.
- 1 scheduled post in the calendar.

All tagged `qa_seed=true` in a column already present OR by a dedicated tag field. Teardown deletes where `qa_seed=true`. Tests MUST NOT depend on pre-existing non-seed rows.

### 4.7 Design-review integration

After the functional suite completes, `design-review/capture.ts` navigates to every page (authenticated) at each viewport and takes clean, non-failure screenshots into `tests/qa/shots/<surface>/<tier>/<page>-<viewport>.png`.

`review-runner.ts` dispatches 6 subagents (one per surface × tier) in parallel. Each subagent receives:
- The relevant screenshots.
- A reference to the actual page source (file path in the repo).
- A prompt from `prompts/<surface>-review.md` that instructs it to use the `design-review`, `ux-psychology`, and `audit` skills.

Each subagent emits `design-review-<surface>-<tier>.json` — an array of findings matching the shared schema used by the functional suite so `aggregate.ts` can merge them seamlessly.

### 4.8 Findings schema

Each finding, regardless of source, conforms to:

```ts
interface Finding {
  id: string;                  // 'dash-compose-03'
  category: 'func'|'stab'|'a11y'|'seo'|'ux'|'design'|'sec'|'perf';
  tier: 1|2|3;
  severity: 'P0'|'P1'|'P2';
  surface: 'dashboard'|'website';
  what: string;                // one sentence
  where: string;               // file:line or file path
  repro?: string[];            // steps — functional only
  expected?: string;
  actual?: string;
  test?: string;               // path to the proving test
  screenshot?: string;         // path under docs/qa/shots/
  suggestedFix?: string;
}
```

### 4.9 `findings.md` format

Severity-grouped, each entry self-contained so a fix agent can work top-to-bottom without cross-referencing:

```markdown
# QA Findings — <ISO timestamp>

_Summary: 3 P0, 11 P1, 24 P2 across 2 surfaces._

## P0 — Broken (blocks ship)

### dash-compose-03  [func] [tier1]
**What:** Post-now button allows double-submit on slow network.
**Where:** dashboard/src/app/compose/page.tsx
**Repro:**
1. /compose → fill topic → set network to Slow 3G
2. Click "Post now" → click again within 2s
**Expected:** Second click ignored.
**Actual:** Two Buffer updates dispatched.
**Test:** tests/qa/dashboard/tier1/compose.spec.ts:47
**Screenshot:** docs/qa/shots/dash-compose-03.png
**Suggested fix:** Disable button while mutation pending; add idempotency key to the post action parallel to the existing generate idempotency.

### …
## P1 — Noticeable
### …
## P2 — Polish
### …
```

## 5. Tier inventory

### 5.1 Dashboard Tier 1 (deep)

Each gets happy path + every plausible error mode + responsive at all 3 viewports + a11y sweep + keyboard nav + design review.

- **`/login`** — request link (happy, invalid email, rate-limited), unauth-redirect bounce from `/compose`, logged-in user bounced back to `/`.
- **`/`** (home) — renders current parsha block, system-health badge live, empty-data state.
- **`/compose`** — topic entry → AI image gen (mocked success + 500) → file upload >4.5MB via signed PUT → post-now vs schedule → double-submit idempotency → monthly cost cap blocks N+1 generation.
- **`/channels`** — Buffer deep-link opens external tab, YouTube OAuth start→callback→connected state, disconnect flow, partial-fail (YT connected + Buffer not).
- **`schedule-all-sheet`** (component) — open from `/videos`, channel multi-select, future-date validation, unmount restores body overflow, mobile tabbar does not hide desktop view (regression guard).
- **`/articles/new` → publish** — full create-to-live with website ISR revalidate assertion (`/api/revalidate` hit, then website shows new article).

### 5.2 Dashboard Tier 2 (happy + 2 error modes + a11y)

`/analytics`, `/calendar`, `/videos`, `/videos/[slug]`, `/settings`, `/settings/buffer`, `/settings/youtube`, `/settings/seo`, `/site-content`, `/jobs/[id]`, `/articles` list + existing-article edit.

### 5.3 Dashboard Tier 3 (smoke)

All `/help/*` subpages (edit-homepage, generate-video, publish-article, schedule-posts, stance, troubleshooting), FAB component, sidebar-nav + mobile tabbar responsive visibility.

### 5.4 Website Tier 1 (deep + SEO + perf)

`/`, `/articles/[slug]`, `/videos/[slug]` — render, metadata, OG tags, responsive, a11y, Lighthouse.

### 5.5 Website Tier 2 (happy + 2 error modes + a11y)

`/about`, `/book`, `/videos` list, `/articles` list.

### 5.6 Website Tier 3 (smoke)

`/sitemap.xml` validity + all published slugs present; `/robots.txt` content; `/articles/feed.xml` RSS validity; `/og?slug=X` returns 200 PNG with correct dimensions; `/api/revalidate` rejects unauth.

### 5.7 Cross-cutting

- **A11y**: axe-core on every Tier 1+2 page + keyboard-only nav trace on Tier 1 flows.
- **SEO**: title, meta description, OG:title, OG:image, OG:url, canonical on every public page; structured data validation.
- **Perf**: Lighthouse on website Tier 1 only.
- **Security**:
  - Unauth GET on every dashboard route → 302 or JSON 401.
  - Every dashboard API route rejects no-cookie request.
  - Website pages contain no admin tokens, no service-role key, no non-public Supabase URL leakage in HTML.
  - CORS headers set on website API routes.

## 6. Execution & reporting

### 6.1 Run sequence

Orchestrated by `npm run qa` at repo root (calls `tests/qa/run.ts`):

1. **global-setup** — provision test user, seed data.
2. **Playwright suites in parallel** — dashboard × 3 viewports, website × 3 viewports, a11y, seo, security.
3. **Lighthouse** — sequential, website Tier 1 only.
4. **design-review/capture** — navigates & screenshots.
5. **design-review/review-runner** — dispatches 6 subagents in parallel.
6. **report/aggregate** — merges all JSON into `docs/qa/findings.md`.
7. **global-teardown** — wipe test user + seed.

Exit code: 0 always — this is a *reporting* tool, not a CI gate. Severity counts appear in the summary line; the fix agent decides what to act on.

### 6.2 Artifacts

- `docs/qa/findings.md` — the canonical punchlist (committed? see Open Questions).
- `docs/qa/shots/**/*.png` — referenced screenshots.
- `tests/qa/shots/` and `tests/qa/results/` — gitignored raw outputs.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Preview URLs change per deploy | `.env.qa` file with URLs + service-role; read by config; fallback to `VERCEL_URL` env |
| Mocks drift from real APIs | Mocks live in one file with URL patterns; when real API shape changes, one update |
| Design-review agent hallucinates "issues" that aren't issues | Prompt requires each finding to cite a specific screenshot region + a specific heuristic (WCAG/Fitts/etc.); human triage before acting |
| Test user's seed data leaks across runs | `qa_seed=true` tag scoped deletes + UUID-per-run in seed values |
| Supabase `admin.generateLink` rate limits | Cache `storageState.json` between runs; refresh every 24h |
| Magic-link redirect_to mismatch | `redirectTo` explicitly points at preview domain; Supabase project's allowed redirect URLs must include it |

## 8. Open questions

1. **Should `findings.md` be committed?** — My lean: yes, per run, with timestamp in filename (`findings-2026-04-20.md`), so history is readable. Alternative: gitignored, regenerate each run.
2. **Dev vs preview Supabase?** — Plan assumes Vercel preview uses the same Supabase project as prod. If not, `.env.qa` needs separate URL/keys.
3. **Cron endpoint testing?** — `/api/cron/reconcile-posts` is hit by Vercel's scheduler. In scope to test the handler directly (auth + happy path), not its scheduling. Treating as Tier 2.

## 9. Implementation plan handoff

Once this spec is approved, the writing-plans skill will break the build into phases:

- **Phase A** — harness scaffolding: `tests/qa/` layout, Playwright config, auth fixture, mocks fixture, seed helper, one canary spec (`dashboard/tier1/login.spec.ts`) running green against preview.
- **Phase B** — Tier 1 specs, dashboard + website.
- **Phase C** — Tier 2 specs.
- **Phase D** — Tier 3 specs.
- **Phase E** — Cross-cutting: a11y, SEO, perf, security.
- **Phase F** — Design-review capture + runner + prompts.
- **Phase G** — Aggregator + `findings.md` generation + `npm run qa` orchestrator.
- **Phase H** — First full run; triage spec failures vs real bugs; lock baseline; update this spec with whatever we missed.
