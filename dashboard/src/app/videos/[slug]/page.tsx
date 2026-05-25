// dashboard/src/app/videos/[slug]/page.tsx
//
// Feature-flag dispatcher. Reads settings.video_page_v2 from site_content
// and routes to either the legacy page (page-legacy.tsx) or the new
// redesigned page (page-new.tsx). See spec §12 for the migration strategy.
//
// Resolution order (first match wins):
//   ?v2=1                          → force new page
//   ?v2=0                          → force legacy page
//   VERCEL_ENV !== 'production'    → new page (preview + local dev default to new)
//   settings.video_page_v2 flag    → flag value (production-only path)

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
  const isNonProd = process.env.VERCEL_ENV !== 'production';
  const useNew =
    override === '1' ? true
    : override === '0' ? false
    : isNonProd ? true
    : await getFlag('video_page_v2');
  return (
    <>
      <BetaToggleBanner mode={useNew ? 'new' : 'legacy'} slug={slug} />
      {useNew ? <VideoDetailPageNew {...props} /> : <VideoDetailPageLegacy {...props} />}
    </>
  );
}
