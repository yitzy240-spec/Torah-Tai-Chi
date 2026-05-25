// dashboard/src/app/videos/[slug]/page.tsx
//
// Feature-flag dispatcher. Routes to either the legacy page
// (page-legacy.tsx) or the new redesigned page (page-new.tsx).
// See spec §12 for the migration strategy.
//
// Resolution order (first match wins):
//   ?v2=1                          → force new page
//   ?v2=0                          → force legacy page
//   vp2 cookie === '1'             → new page (persisted from banner click)
//   vp2 cookie === '0'             → legacy page (persisted from banner click)
//   VERCEL_ENV !== 'production'    → new page (preview + local dev default to new)
//   settings.video_page_v2 flag    → flag value (production-only path)
//
// The cookie matters because the new page's router.push calls in
// phase-N-connected.tsx only preserve the path (/videos/<slug>?phase=N),
// not the v2 query param. Without persisted preference the user clicks
// "Generate clip plan" and the next render falls back to the (off-in-
// prod) flag, kicking them to legacy mid-flow. The banner sets the
// cookie via /api/beta-mode.

import { cookies } from 'next/headers';
import { getFlag } from '@/lib/feature-flag';
import VideoDetailPageLegacy from './page-legacy';
import VideoDetailPageNew from './page-new';
import { BetaToggleBanner } from './_components/beta-toggle-banner';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VideoDetailPage(props: PageProps) {
  const { slug } = await props.params;
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
  return (
    <>
      <BetaToggleBanner mode={useNew ? 'new' : 'legacy'} slug={slug} />
      {useNew ? <VideoDetailPageNew {...props} /> : <VideoDetailPageLegacy {...props} />}
    </>
  );
}
