// dashboard/src/app/page.tsx
//
// Feature-flag dispatcher for the dashboard landing page.
// Reads settings.video_page_v2 from site_content and routes to either
// the legacy landing (page-legacy.tsx) or the new redesigned landing
// (page-new.tsx).
//
// Query override for side-by-side testing:
//   ?v2=1  — force new landing regardless of flag
//   ?v2=0  — force legacy landing regardless of flag

import { getFlag } from '@/lib/feature-flag';
import TodayPageLegacy from './page-legacy';
import DashboardLandingNew from './page-new';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DashboardRoot(props: PageProps) {
  const sp = await props.searchParams;
  const override = typeof sp.v2 === 'string' ? sp.v2 : null;
  const useNew = override === '1' ? true : override === '0' ? false : await getFlag('video_page_v2');
  return useNew ? <DashboardLandingNew searchParams={props.searchParams} /> : <TodayPageLegacy />;
}
