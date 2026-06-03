import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  // ISR mode — no static export; Vercel handles image optimisation natively.
  // Pages revalidate on a per-route schedule and on-demand via the Storyblok
  // webhook at /api/revalidate.
};

// Wrap with Sentry for source-map upload + tunnel route.
export default withSentryConfig(nextConfig, {
  org: 'torah-tai-chi',
  project: 'javascript-nextjs',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: '/monitoring',
  widenClientFileUpload: true,
  silent: !process.env.CI,
  disableLogger: true,
});
