// dashboard/sentry.server.config.ts
//
// Sentry init for the Node.js server runtime (server components, server
// actions, API route handlers running in Node).

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  // Capture local variable values in stack traces — invaluable when
  // tracing a Modal webhook 5xx without having to redeploy with extra logs.
  includeLocalVariables: true,
  environment: process.env.VERCEL_ENV ?? 'development',
  initialScope: { tags: { service: 'dashboard', runtime: 'node' } },
});
