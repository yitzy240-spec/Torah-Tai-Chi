// dashboard/src/app/videos/[slug]/_data/live-at-rest-data.ts
//
// Data preparation for the LiveAtRest / live-and-draft landing view.
// Fetches the live video row + its posts in parallel, then derives the
// per-channel platform status list.

import { createClient } from '@/lib/supabase/server';
import type { PlatformStatus } from '../_components/live-at-rest';
import type { ShellData } from './shell-data';

export type LiveAtRestProps = {
  parshaName: string;
  parshaId: string;
  sourceScriptId: string;
  versionLabel: string;
  videoMp4Url: string;
  thumbPath: string | null;
  websiteUrl: string;
  /** The BIG heading — the creative script title ("In the Desert…") */
  displayTitle: string;
  /** The smaller attribution — the parsha name ("Bamidbar") */
  attribution: string;
  publishedToWebsiteSince: string | null;
  platforms: PlatformStatus[];
  parshaSlug: string;
  draftStripPhase: ShellData['statePhase'];
  draftJobId: string | null;
  clipsRendered: number;
  clipsTotal: number | null;
};

export async function getLiveAtRestProps(
  parshaSlug: string,
  parshaName: string,
  parshaId: string,
  liveVideoId: string,
  videosForState: ShellData['videosForState'],
  clipsByJobId: ShellData['clipsByJobId'],
  statePhase: ShellData['statePhase'],
  draftJobId: string | null,
): Promise<LiveAtRestProps> {
  const supabase = await createClient();

  // Parallelize: live video row + live posts — independent
  const [liveVRowResult, livePostsResult] = await Promise.all([
    supabase
      .from('videos')
      .select('id, mp4_path, thumb_path, title, subtitle, published_to_website, post_urls, created_at')
      .eq('id', liveVideoId)
      .single(),
    supabase
      .from('posts')
      .select('platform, status, created_at')
      .eq('video_id', liveVideoId)
      .order('created_at', { ascending: false }),
  ]);

  const liveVRow = liveVRowResult.data;

  // Public storage URLs (sync)
  let liveVideoMp4Url: string | null = null;
  let liveThumbUrl: string | null = null;
  if (liveVRow?.mp4_path) {
    const { data: u } = supabase.storage
      .from('videos')
      .getPublicUrl(liveVRow.mp4_path as string);
    liveVideoMp4Url = u?.publicUrl ?? null;
  }
  if (liveVRow?.thumb_path) {
    const { data: u } = supabase.storage
      .from('videos')
      .getPublicUrl(liveVRow.thumb_path as string);
    liveThumbUrl = u?.publicUrl ?? null;
  }

  // Build per-channel status list
  const postsByPlatform = new Map<string, { postedAt: string | null; postUrl: string | null }>();
  for (const p of livePostsResult.data ?? []) {
    if (p.status === 'published' && !postsByPlatform.has(p.platform as string)) {
      postsByPlatform.set(p.platform as string, {
        postedAt: (p.created_at as string | null) ?? null,
        postUrl: null,
      });
    }
  }

  const postUrls = (liveVRow?.post_urls as Record<string, string> | null) ?? {};
  for (const [platform, url] of Object.entries(postUrls)) {
    if (postsByPlatform.has(platform)) {
      postsByPlatform.set(platform, {
        ...(postsByPlatform.get(platform)!),
        postUrl: url,
      });
    }
  }

  const isPublishedToWebsite = !!(liveVRow?.published_to_website as boolean | null);
  const liveVideoCreatedAt = (liveVRow?.created_at as string | null) ?? null;
  const platformStatusList: PlatformStatus[] = [
    {
      platform: 'torahtaichi.com',
      postedAt: isPublishedToWebsite ? liveVideoCreatedAt : null,
      postUrl: isPublishedToWebsite ? `https://torahtaichi.com/${parshaSlug}` : null,
      viewsLabel: null,
    },
    ...Array.from(postsByPlatform.entries()).map(([platform, info]) => ({
      platform,
      postedAt: info.postedAt,
      postUrl: info.postUrl,
      viewsLabel: null,
    })),
  ];

  const liveIdx = videosForState.findIndex((v) => v.id === liveVideoId) + 1;
  const versionLabel = `v${liveIdx}`;

  // Fetch script_id from the live job (needed for DraftCalloutStrip replace flow)
  const liveVideoJobEntry = videosForState.find((v) => v.id === liveVideoId);
  const liveJobId = liveVideoJobEntry?.jobId ?? null;
  let liveScriptId: string | null = null;
  if (liveJobId) {
    const { data: liveJobDetail } = await supabase
      .from('jobs')
      .select('script_id')
      .eq('id', liveJobId)
      .single();
    liveScriptId = (liveJobDetail?.script_id as string | null) ?? null;
  }

  const draftClips = draftJobId ? (clipsByJobId[draftJobId] ?? []) : [];
  const clipsRendered = draftClips.filter((c) => c.storagePath !== null).length;
  const clipsTotal = draftClips.length > 0 ? draftClips.length : null;

  return {
    parshaName,
    parshaId,
    sourceScriptId: liveScriptId ?? '',
    versionLabel,
    videoMp4Url: liveVideoMp4Url ?? '',
    thumbPath: liveThumbUrl,
    websiteUrl: `https://torahtaichi.com/${parshaSlug}`,
    // DB column meanings: videos.subtitle = creative title, videos.title = parsha name.
    // Prop names match what they render as (displayTitle = big heading, attribution = small label).
    displayTitle: (liveVRow?.subtitle as string | null) ?? '',
    attribution: (liveVRow?.title as string | null) ?? parshaName,
    publishedToWebsiteSince: null,
    platforms: platformStatusList,
    parshaSlug,
    draftStripPhase: statePhase,
    draftJobId,
    clipsRendered,
    clipsTotal,
  };
}
