'use server';

import { autoPost } from '@/lib/auto-post';
import type { Platform } from '@/lib/platforms';
import { createClient } from '@/lib/supabase/server';

interface PostAllArgs {
  videoId: string;
  captions: Partial<Record<Platform, string>>;
  platforms: readonly Platform[];
  scheduledAt?: Date;
  shareNow?: boolean;
  /** Operator's hand-picked YouTube cover frame URL (from
   *  saveYouTubeThumbnail, persisted to videos.youtube_thumbnail_url).
   *  Forwarded to autoPost so the YouTube channel in this fanout uses
   *  the operator's frame instead of the auto-extracted thumb_path.
   *  Optional: omitted = autoPost falls back to videos.thumb_path. */
  youtubeThumbnailUrl?: string;
}

export async function postAllPlatforms(args: PostAllArgs): Promise<{
  results?: Array<{ platform: Platform; externalId: string }>;
  errors?: Array<{ platform: Platform; message: string }>;
}> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return { errors: args.platforms.map((p) => ({ platform: p, message: 'Not authenticated' })) };
  }

  const res = await autoPost({
    videoId: args.videoId,
    captions: args.captions,
    selectedPlatforms: args.platforms,
    scheduledAt: args.scheduledAt ?? new Date(),
    shareNow: args.shareNow ?? true,
    youtubeThumbnailUrl: args.youtubeThumbnailUrl,
  });

  if (res.error) {
    return { errors: args.platforms.map((p) => ({ platform: p, message: res.error! })) };
  }

  return { results: res.results ?? [] };
}
