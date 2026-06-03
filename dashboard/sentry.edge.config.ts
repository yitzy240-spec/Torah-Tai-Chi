// dashboard/sentry.edge.config.ts
//
// Sentry init for the Edge runtime (middleware, edge API routes).
// We use Node runtime for most server code, but middleware.ts runs at
// the edge and needs its own init.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  environment: process.env.VERCEL_ENV ?? 'development',
  initialScope: { tags: { service: 'dashboard', runtime: 'edge' } },
});
