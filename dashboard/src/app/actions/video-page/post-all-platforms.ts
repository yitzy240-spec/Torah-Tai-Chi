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
  });

  if (res.error) {
    return { errors: args.platforms.map((p) => ({ platform: p, message: res.error! })) };
  }

  return { results: res.results ?? [] };
}
