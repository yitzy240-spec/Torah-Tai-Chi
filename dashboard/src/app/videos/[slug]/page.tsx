// dashboard/src/app/videos/[slug]/page.tsx
//
// Feature-flag dispatcher. Reads settings.video_page_v2 from site_content
// and routes to either the legacy page (page-legacy.tsx) or the new
// redesigned page (page-new.tsx). See spec §12 for the migration strategy.
//
// Query override for side-by-side testing without flipping the flag globally:
//   ?v2=1  — force new page regardless of flag
//   ?v2=0  — force legacy page regardless of flag

import { getFlag } from '@/lib/feature-flag';
import VideoDetailPageLegacy from './page-legacy';
import VideoDetailPageNew from './page-new';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VideoDetailPage(props: PageProps) {
  // settings.video_page_v2 is the rollout flag. Default false (legacy)
  // until explicitly seeded; see dashboard/supabase/seeds/video_page_v2_flag.sql.
  const sp = await props.searchParams;
  const override = typeof sp.v2 === 'string' ? sp.v2 : null;
  const useNew = override === '1' ? true : override === '0' ? false : await getFlag('video_page_v2');
  return useNew ? <VideoDetailPageNew {...props} /> : <VideoDetailPageLegacy {...props} />;
}
