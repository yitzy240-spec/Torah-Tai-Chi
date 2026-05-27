// dashboard/src/app/page.tsx
//
// Feature-flag dispatcher for the dashboard landing page. Mirrors the
// /videos/[slug]/page.tsx dispatcher so a beta opt-in on any video page
// carries to the landing too. Without the cookie check the operator
// opts in from a video page, returns to "Today," and lands back on the
// legacy script-approval UI — exactly the regression Yonah hit before
// the Naso smoke test.
//
// Resolution order (first match wins):
//   ?v2=1                          → force new landing
//   ?v2=0                          → force legacy landing
//   vp2 cookie === '1'             → new landing (persisted from banner)
//   vp2 cookie === '0'             → legacy landing (persisted from banner)
//   VERCEL_ENV !== 'production'    → new landing (preview + local dev default to new)
//   settings.video_page_v2 flag    → flag value (production-only path)

import { cookies } from 'next/headers';
import { getFlag } from '@/lib/feature-flag';
import TodayPageLegacy from './page-legacy';
import DashboardLandingNew from './page-new';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DashboardRoot(props: PageProps) {
  const sp = await props.searchParams;
  const override = typeof sp.v2 === 'string' ? sp.v2 : null;
  const cookieStore = await cookies();
  const cookieMode = cookieStore.get('vp2')?.value ?? null;
  const isNonProd = process.env.VERCEL_ENV !== 'production';
  const useNew =
    override === '1' ? true
    : override === '0' ? false
    : cookieMode === '1' ? true
    : cookieMode === '0' ? false
    : isNonProd ? true
    : await getFlag('video_page_v2');
  return useNew ? <DashboardLandingNew searchParams={props.searchParams} /> : <TodayPageLegacy />;
}
