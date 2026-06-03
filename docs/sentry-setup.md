# Sentry Setup (Phase -1 item #1)

**Status:** sketched, not activated. Waiting on you to create a Sentry account + project + DSN before the code changes ship.

**Why:** Vercel function logs are reactive only — discovered after Yonah complains. Modal worker has zero observability beyond `execution_events`. Phase 0 deploys silent-data-loss fixes to prod; we want to see breakage immediately, not on Yonah's next session. Sentry's free tier (5,000 errors / 10,000 performance events per month) covers our volume comfortably.

---

## Your one-time setup

1. Sign up at https://sentry.io (free tier — pick "Developer" plan).
2. Create **two projects**, both type **Next.js**:
   - `torah-tai-chi-dashboard`
   - `torah-tai-chi-website`
3. From each project's Settings → Client Keys (DSN), copy the **DSN** (looks like `https://<key>@o<org>.ingest.sentry.io/<project>`).
4. Add to **Vercel env vars** for each project respectively:
   - `NEXT_PUBLIC_SENTRY_DSN` (dashboard project → use dashboard DSN; website project → use website DSN)
   - `SENTRY_AUTH_TOKEN` (one token, both projects — Settings → Account → API → Auth Tokens, scope: `project:read project:releases`)
5. (Optional — for source maps:) Set `SENTRY_ORG` and `SENTRY_PROJECT` per project in Vercel env.
6. **Tell me the DSNs are set** and I'll run the activation steps below.

---

## My activation steps (after you give the go-ahead)

### Dashboard
```bash
cd dashboard
npm install --save @sentry/nextjs
```

Then create the 3 config files (templates below) at the dashboard root.

### Website
Same — `npm install --save @sentry/nextjs` in `website/`, then config files.

### Modal worker (Python)
```bash
pip install sentry-sdk
```
Add to `pyproject.toml` deps. Initialize in `modal_app.py` at top:
```python
import sentry_sdk
sentry_sdk.init(
    dsn=os.environ["SENTRY_DSN_MODAL"],
    environment=os.environ.get("MODAL_ENVIRONMENT", "main"),
    traces_sample_rate=0.05,  # 5% of pipeline runs traced
    profiles_sample_rate=0,    # off; not useful for our workload
)
```

The Modal Sentry project can be a third Sentry project or you can reuse one of the Next ones with a `service` tag — pick when activating.

---

## Config file templates

These match the standard `@sentry/nextjs` v9 setup. Drop them at the dashboard or website root unchanged.

### `sentry.client.config.ts`
```ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Sample 10% of sessions for performance traces. Adjust if quota tight.
  tracesSampleRate: 0.10,
  // Capture 100% of sessions where an error occurs; 10% otherwise.
  replaysSessionSampleRate: 0.10,
  replaysOnErrorSampleRate: 1.0,
  // Don't ingest the noise from extensions / 3p scripts.
  ignoreErrors: [
    'ResizeObserver loop',
    'Non-Error promise rejection captured',
  ],
  // Filter out PII before send.
  beforeSend(event) {
    if (event.user) delete event.user.ip_address;
    return event;
  },
});
```

### `sentry.server.config.ts`
```ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.10,
  // Tag every event with which env it came from so we can filter
  // staging vs production once staging exists.
  environment: process.env.VERCEL_ENV ?? 'development',
});
```

### `sentry.edge.config.ts`
```ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.10,
});
```

### `next.config.ts` wrapper
Currently `next.config.ts` exports the bare config. Wrap with Sentry's wrapper:
```ts
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  // ...existing config...
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  // Upload source maps only in CI/Vercel, not local dev.
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});
```

---

## What to add to `.env.local.example` (both apps)

```
# Sentry — error monitoring + performance traces.
# Get DSN from sentry.io project settings → Client Keys.
NEXT_PUBLIC_SENTRY_DSN=
# Auth token for source-map upload during build (optional but recommended for prod).
# sentry.io → Settings → Account → API → Auth Tokens, scope: project:read project:releases.
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

---

## How to use Sentry once active

### Capture an exception manually
```ts
import * as Sentry from '@sentry/nextjs';
try {
  await riskyOperation();
} catch (err) {
  Sentry.captureException(err, { tags: { area: 'auto-post', platform: 'instagram' } });
  throw err;  // re-throw if caller expects it
}
```

### Tag with job context (useful for tracing a render incident across dashboard + Modal)
```ts
Sentry.setContext('job', { id: jobId, parshaSlug, mode: 'compose' });
```

### Add to existing log paths
Wherever the code currently does `console.error(...)`, add:
```ts
if (process.env.NODE_ENV === 'production') {
  Sentry.captureMessage(message, 'error');
}
```

The dashboard's [hebcal-slug.ts:124](dashboard/src/lib/hebcal-slug.ts#L124) currently does `console.error` for unmapped parshiot — that's the first place to add a Sentry capture once active.

---

## Cost expectations

- Free tier: 5K errors/mo + 10K traces/mo + 50 replays/mo.
- Our volume estimate: <500 errors/mo (one operator + a few cron jobs), maybe 2K traces/mo at 10% sampling.
- If we exceed: Sentry's "Team" plan is $26/mo and bumps quotas 5×.

## What you should NOT capture in Sentry

- Supabase auth tokens (already filtered by `beforeSend`)
- API request bodies that contain Yonah's draft script text (potentially private until published)
- Buffer access token (env var — never logged anyway)
- Anything from `/api/auth/*` paths beyond the error itself

---

## Rollback

If Sentry causes any issue (bundle bloat, perf regression, false-positive noise) — set `NEXT_PUBLIC_SENTRY_DSN=` (empty) in Vercel and the SDK self-disables. No code change required.
