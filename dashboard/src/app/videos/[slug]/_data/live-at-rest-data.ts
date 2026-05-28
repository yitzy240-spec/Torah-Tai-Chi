// dashboard/src/app/videos/[slug]/_data/live-at-rest-data.ts
//
// Data preparation for the LiveAtRest / live-and-draft landing view.
// Fetches the live video row + its posts in parallel, then derives the
// per-channel platform status list.
//
// B2 expansion: also fetches all 5 site CMS fields + canonical clip plan
// captions/social_metadata/youtube_tags + connected platforms so the
// live page can render per-platform posted cards.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCanonicalClipPlan } from '@/lib/clip-plan';
import { getConnectedPlatforms } from '@/lib/connected-platforms';
import type { PlatformStatus } from '../_components/live-at-rest';
import type { ShellData } from './shell-data';
import { ACTIVE_PLATFORMS, type Platform } from '@/lib/platforms';

export type LiveAtRestPost = {
  id: string;
  platform: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  published_at: string | null;
  buffer_update_id: string | null;
  caption: string | null;
  error_message: string | null;
};

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

  // B2: site CMS fields (all 5 fields the public website renders)
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  siteWebsiteCaption: string;
  siteSpokenScript: string;

  // B2: per-platform posted cards data
  liveJobId: string | null;
  captions: Record<string, string>;
  youtubeTags: string[];
  socialMetadata: {
    instagram?: { type: 'reel' | 'post'; firstComment?: string };
    facebook?: { type: 'reel' | 'post'; firstComment?: string };
  } | null;
  /** All posts for the live video (status='published') */
  livePosts: LiveAtRestPost[];
  /** Platform URL map from videos.post_urls */
  postUrls: Record<string, string>;
  connectedPlatforms: Platform[];
  videoId: string;
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
  const supabaseSvc = createServiceClient();

  // Find the job that produced the live video (needed for canonical plan lookup)
  const liveVideoJobEntry = videosForState.find((v) => v.id === liveVideoId);
  const liveJobId = liveVideoJobEntry?.jobId ?? null;

  // Parallelize: live video row + live posts + canonical clip plan + connected platforms
  const [liveVRowResult, livePostsResult, canonicalPlan, connectedPlatforms, jobDetailResult] =
    await Promise.all([
      supabase
        .from('videos')
        .select(
          'id, mp4_path, thumb_path, title, subtitle, description, website_caption, spoken_script, published_to_website, post_urls, created_at',
        )
        .eq('id', liveVideoId)
        .single(),
      supabase
        .from('posts')
        .select('id, platform, status, created_at, scheduled_at, published_at, buffer_update_id, caption, error_message')
        .eq('video_id', liveVideoId)
        .order('created_at', { ascending: false }),
      liveJobId ? getCanonicalClipPlan(supabaseSvc, liveJobId) : Promise.resolve(null),
      getConnectedPlatforms(),
      // Also resolve the script_id for the replace-version flow
      liveJobId
        ? supabase.from('jobs').select('script_id').eq('id', liveJobId).single()
        : Promise.resolve({ data: null }),
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

  // Build per-channel status list (for the simple status display in the hero).
  // Skip platforms not in ACTIVE_PLATFORMS so the swap-out (e.g., TikTok ⇒
  // disconnected 2026-05-28 in favor of Facebook) hides those historical
  // rows from the dashboard. The posts themselves remain in the DB and on
  // the external platform — we just stop surfacing them in the UI.
  const activeSet = new Set<string>(ACTIVE_PLATFORMS);
  const postsByPlatform = new Map<string, { postedAt: string | null; postUrl: string | null }>();
  for (const p of livePostsResult.data ?? []) {
    const platform = p.platform as string;
    if (!activeSet.has(platform)) continue;
    if (p.status === 'published' && !postsByPlatform.has(platform)) {
      postsByPlatform.set(platform, {
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

  const liveScriptId = (jobDetailResult.data?.script_id as string | null) ?? null;

  const draftClips = draftJobId ? (clipsByJobId[draftJobId] ?? []) : [];
  const clipsRendered = draftClips.filter((c) => c.storagePath !== null).length;
  const clipsTotal = draftClips.length > 0 ? draftClips.length : null;

  // B2: clip plan captions + social meta + youtube tags
  let clipPlanMeta: {
    social_metadata: Record<string, unknown> | null;
    youtube_tags: string[];
    captions: Record<string, string>;
  } = { social_metadata: null, youtube_tags: [], captions: {} };

  if (canonicalPlan) {
    const { data: cpRow } = await supabase
      .from('clip_plans')
      .select('social_metadata, youtube_tags')
      .eq('id', canonicalPlan.id)
      .maybeSingle();
    const planJson = (canonicalPlan.planJson ?? {}) as Record<string, unknown>;
    clipPlanMeta = {
      social_metadata: (cpRow?.social_metadata as Record<string, unknown> | null) ?? null,
      youtube_tags: (cpRow?.youtube_tags as string[] | null) ?? [],
      captions: (planJson.captions as Record<string, string> | undefined) ?? {},
    };
  }

  // B2: all published posts (for per-platform cards)
  const livePosts: LiveAtRestPost[] = (livePostsResult.data ?? []).map((p) => ({
    id: p.id as string,
    platform: p.platform as string,
    status: p.status as string,
    created_at: (p.created_at as string | null) ?? new Date(0).toISOString(),
    scheduled_at: (p.scheduled_at as string | null) ?? null,
    published_at: (p.published_at as string | null) ?? null,
    buffer_update_id: (p.buffer_update_id as string | null) ?? null,
    caption: (p.caption as string | null) ?? null,
    error_message: (p.error_message as string | null) ?? null,
  }));

  return {
    videoId: liveVideoId,
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
    // Source-of-truth for "LIVE since N": MAX(posts.published_at) across all
    // platforms posted for this video. No videos.published_to_website_at
    // column exists (see 20260426_videos_publish_gate.sql), so we use the
    // moment any platform first went live as the proxy. Returns null when no
    // post carries a published_at yet.
    publishedToWebsiteSince: isPublishedToWebsite
      ? livePosts.reduce<string | null>((max, post) => {
          if (!post.published_at) return max;
          if (max === null || post.published_at > max) return post.published_at;
          return max;
        }, null)
      : null,
    platforms: platformStatusList,
    parshaSlug,
    draftStripPhase: statePhase,
    draftJobId,
    clipsRendered,
    clipsTotal,

    // B2: site CMS fields
    siteTitle: (liveVRow?.title as string | null) ?? parshaName,
    siteSubtitle: (liveVRow?.subtitle as string | null) ?? '',
    siteDescription: (liveVRow?.description as string | null) ?? '',
    siteWebsiteCaption: (liveVRow?.website_caption as string | null) ?? '',
    siteSpokenScript: (liveVRow?.spoken_script as string | null) ?? '',

    // B2: per-platform posted cards data
    liveJobId,
    captions: clipPlanMeta.captions,
    youtubeTags: clipPlanMeta.youtube_tags,
    socialMetadata: clipPlanMeta.social_metadata as LiveAtRestProps['socialMetadata'],
    livePosts,
    postUrls,
    connectedPlatforms,
  };
}
