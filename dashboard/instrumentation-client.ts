// dashboard/instrumentation-client.ts
//
// Sentry initialization for the BROWSER runtime (Next 16 App Router).
// This filename is the Next 16 convention — replaces the old
// `sentry.client.config.ts` from Next 14 / @sentry/nextjs v8.
//
// The DSN is public-safe — it's the same value baked into client JS by
// every Sentry-instrumented site on the web. Real "secrets" are the
// SENTRY_AUTH_TOKEN (build-time source map upload only).

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 10% of transactions traced in prod; 100% in dev for quick verification.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // Session Replay: 10% of all sessions, 100% of sessions that error.
  // Free tier covers 50 replays/month — fine for a 1-operator dashboard.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
  // Drop the noise floor.
  ignoreErrors: [
    'ResizeObserver loop',
    'Non-Error promise rejection captured',
  ],
  // Tag every event so we can filter dashboard vs website in the shared
  // Sentry project.
  initialScope: { tags: { service: 'dashboard' } },
});

// Required so Next can capture client-side navigation transitions for
// performance traces. Exported by name — Next looks for this export.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
