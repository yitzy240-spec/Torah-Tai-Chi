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
  ],
  initialScope: { tags: { service: 'website' } },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
