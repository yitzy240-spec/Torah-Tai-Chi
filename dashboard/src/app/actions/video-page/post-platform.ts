'use server';

// Posts to ONE platform by reusing autoPost with selectedPlatforms:[platform].
// Per EXECUTION-NOTES.md "Buffer + auto-post": do NOT re-implement the posting fanout.
// Honors scheduledAt + shareNow for schedule-for-later functionality.

import { autoPost } from '@/lib/auto-post';
import type { Platform } from '@/lib/platforms';
import { createClient } from '@/lib/supabase/server';

export async function postToPlatform(
  videoId: string,
  platform: Platform,
  captions: Partial<Record<Platform, string>>,
  options: { scheduledAt?: Date; shareNow?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const res = await autoPost({
    videoId,
    captions,
    selectedPlatforms: [platform],
    scheduledAt: options.scheduledAt ?? new Date(),
    shareNow: options.shareNow ?? true,
  });

  if (res.error) return { ok: false, error: res.error };
  return { ok: true };
}
