// dashboard/src/app/videos/[slug]/_data/phase-5-data.ts
//
// Data preparation for Phase 5 (Posting).
// Two-wave fetch: Wave A (video row + canonical plan + posts + connected
// platforms + job script_id) then Wave B (clip_plan social/youtube meta,
// which needs the plan id from Wave A).

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCanonicalClipPlan } from '@/lib/clip-plan';
import { getConnectedPlatforms } from '@/lib/connected-platforms';
import type { Platform } from '@/lib/platforms';

export type Phase5Post = {
  id: string;
  platform: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  published_at: string | null;
  buffer_update_id: string | null;
  caption: string | null;
};

export type Phase5VideoRow = {
  id: string;
  mp4_path: string | null;
  thumb_path: string | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  published_to_website: boolean;
  post_urls: Record<string, string> | null;
};

export type Phase5Props = {
  videoId: string;
  parshaSlug: string;
  parshaId: string;
  sourceScriptId: string;
  isLive: boolean;
  liveSince: string | null;
  liveVersionLabel: string | null;
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  websiteUrl: string;
  jobId: string;
  captions: Record<string, string>;
  youtubeTags: string[];
  socialMetadata: {
    instagram?: { type: 'reel' | 'post'; firstComment?: string };
    facebook?: { type: 'reel' | 'post'; firstComment?: string };
  } | null;
  initialPosts: Phase5Post[];
  postUrls: Record<string, string>;
  connectedPlatforms: Platform[];
  videoMp4Url: string | null;
  /** Named thumbPath to match Phase5PostConnected's prop */
  thumbPath: string | null;
  liveVideoIndex: number;
};

export async function getPhase5Props(
  parshaSlug: string,
  parshaId: string,
  parshaName: string,
  draftJobId: string,
  draftVideoId: string,
  videosForState: Array<{ id: string; jobId: string; publishedToWebsite: boolean }>,
): Promise<Phase5Props> {
  const supabase = await createClient();
  const supabaseSvc = createServiceClient();

  // Wave A: video row + canonical plan + posts + connected platforms + job script_id
  const [videoResult, canonicalPlan, postsResult, connectedPlatforms, jobDetailResult] =
    await Promise.all([
      supabase
        .from('videos')
        .select('id, mp4_path, thumb_path, title, subtitle, description, published_to_website, post_urls')
        .eq('id', draftVideoId)
        .single(),
      getCanonicalClipPlan(supabaseSvc, draftJobId),
      supabase
        .from('posts')
        .select('id, platform, status, created_at, scheduled_at, published_at, buffer_update_id, caption')
        .eq('video_id', draftVideoId)
        .order('created_at', { ascending: false }),
      getConnectedPlatforms(),
      supabase.from('jobs').select('script_id').eq('id', draftJobId).single(),
    ]);

  // Wave B: clip plan social/youtube meta (needs canonical plan id from Wave A)
  let clipPlanMeta: {
    social_metadata: Record<string, unknown> | null;
    youtube_tags: string[];
  } = { social_metadata: null, youtube_tags: [] };
  if (canonicalPlan) {
    const { data: cpRow } = await supabase
      .from('clip_plans')
      .select('social_metadata, youtube_tags')
      .eq('id', canonicalPlan.id)
      .maybeSingle();
    clipPlanMeta = {
      social_metadata: (cpRow?.social_metadata as Record<string, unknown> | null) ?? null,
      youtube_tags: (cpRow?.youtube_tags as string[] | null) ?? [],
    };
  }

  const vRow = videoResult.data;
  const videoRow: Phase5VideoRow | null = vRow
    ? {
        id: vRow.id as string,
        mp4_path: (vRow.mp4_path as string | null) ?? null,
        thumb_path: (vRow.thumb_path as string | null) ?? null,
        title: (vRow.title as string | null) ?? null,
        subtitle: (vRow.subtitle as string | null) ?? null,
        description: (vRow.description as string | null) ?? null,
        published_to_website: !!(vRow.published_to_website as boolean | null),
        post_urls: (vRow.post_urls as Record<string, string> | null) ?? null,
      }
    : null;

  const planJson = ((canonicalPlan?.planJson ?? {}) as Record<string, unknown>);
  const captions = (planJson.captions as Record<string, string> | undefined) ?? {};

  const initialPosts: Phase5Post[] = (postsResult.data ?? []).map((p) => ({
    id: p.id as string,
    platform: p.platform as string,
    status: p.status as string,
    created_at: (p.created_at as string | null) ?? new Date(0).toISOString(),
    scheduled_at: (p.scheduled_at as string | null) ?? null,
    published_at: (p.published_at as string | null) ?? null,
    buffer_update_id: (p.buffer_update_id as string | null) ?? null,
    caption: (p.caption as string | null) ?? null,
  }));

  const draftScriptId = (jobDetailResult.data?.script_id as string | null) ?? '';

  // Public storage URLs (sync — no network; just URL construction)
  let videoMp4Url: string | null = null;
  let thumbPath: string | null = null;
  if (videoRow?.mp4_path) {
    const { data: urlData } = supabase.storage.from('videos').getPublicUrl(videoRow.mp4_path);
    videoMp4Url = urlData?.publicUrl ?? null;
  }
  if (videoRow?.thumb_path) {
    const { data: urlData } = supabase.storage.from('videos').getPublicUrl(videoRow.thumb_path);
    thumbPath = urlData?.publicUrl ?? null;
  }

  const siteIsLive = videoRow?.published_to_website ?? false;
  const liveVideoIndex = videosForState.findIndex((v) => v.id === draftVideoId) + 1;
  const liveVersionLabel = siteIsLive ? `v${liveVideoIndex}` : null;

  return {
    videoId: draftVideoId,
    parshaSlug,
    parshaId,
    sourceScriptId: draftScriptId,
    isLive: siteIsLive,
    liveSince: null, // TODO: surface actual published_at when added
    liveVersionLabel,
    siteTitle: videoRow?.title ?? parshaName,
    siteSubtitle: videoRow?.subtitle ?? '',
    siteDescription: videoRow?.description ?? '',
    websiteUrl: `https://torahtaichi.com/${parshaSlug}`,
    jobId: draftJobId,
    captions,
    youtubeTags: clipPlanMeta.youtube_tags,
    socialMetadata: clipPlanMeta.social_metadata as Phase5Props['socialMetadata'],
    initialPosts,
    postUrls: (videoRow?.post_urls ?? {}) as Record<string, string>,
    connectedPlatforms,
    videoMp4Url,
    thumbPath,
    liveVideoIndex,
  };
}
