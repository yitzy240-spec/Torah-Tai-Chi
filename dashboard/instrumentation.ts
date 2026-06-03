// dashboard/instrumentation.ts
//
// Next 16 server-instrumentation entry point. Next imports the right
// runtime's Sentry init based on which environment is starting. The
// onRequestError hook captures unhandled exceptions in server actions
// and route handlers.

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
