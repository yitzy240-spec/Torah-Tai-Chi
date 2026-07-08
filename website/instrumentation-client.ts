// website/instrumentation-client.ts
//
// Sentry init for browser runtime on the public website.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
  ignoreErrors: [
    'ResizeObserver loop',
    'Non-Error promise rejection captured',
    // Browser-extension / injected-script noise, not our code. "EmptyRanges"
    // exists nowhere in the bundle and the stack is an anonymous "undefined"
    // source — a classic extension error Sentry's global handler catches
    // (getsentry/sentry-javascript#8444). Reported on /videos/matot 2026-07-08.
    'EmptyRanges',
  ],
  initialScope: { tags: { service: 'website' } },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
