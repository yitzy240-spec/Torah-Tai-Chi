import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ISR mode — no static export; Vercel handles image optimisation natively.
  // Pages revalidate on a per-route schedule and on-demand via the Storyblok
  // webhook at /api/revalidate.
};

export default nextConfig;
