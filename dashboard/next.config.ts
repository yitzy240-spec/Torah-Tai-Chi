import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  // Allow Next/Image to optimize public-storage URLs from the project's
  // Supabase bucket. Needed by MotionPickerSheet posters (Phase 4.1),
  // YouTube thumbnail picker, and any future <Image> consumer that points
  // at a storage URL. The hostname is the project ref; if the Supabase
  // project ever changes, update both here and NEXT_PUBLIC_SUPABASE_URL.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'jswdfthmegjbhnwbgeca.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

// Wrap with Sentry's plugin so source maps upload at build time and the
// /monitoring tunnel route is available to bypass client-side ad-blockers
// that hard-block sentry.io.
export default withSentryConfig(nextConfig, {
  org: 'torah-tai-chi',
  project: 'javascript-nextjs',
  // SENTRY_AUTH_TOKEN is only needed for source-map upload at build time.
  // Optional — without it, errors still report but stack traces point at
  // minified JS instead of original TS.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Route Sentry events through this Next app's domain. Bypasses ad-blockers
  // that block sentry.io directly. Middleware matcher excludes /monitoring.
  tunnelRoute: '/monitoring',
  // Upload more client-side source maps (worth the extra ~5s build time).
  widenClientFileUpload: true,
  // Quiet CLI output unless CI.
  silent: !process.env.CI,
  disableLogger: true,
});
