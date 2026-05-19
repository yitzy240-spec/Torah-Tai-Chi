'use server';

// Removes the video from the public website (published_to_website = false).
// Reuses setVideoPublished so the auto-unpublish-sibling invariant is respected
// (it is a no-op when publishing=false, but keeps all invariant logic in one place).

import { createClient } from '@/lib/supabase/server';
import { setVideoPublished } from '@/app/actions/set-video-published';

export async function unpublishSite(
  videoId: string,
  parshaSlug: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const result = await setVideoPublished(videoId, false, parshaSlug);
  if (result.error) return { ok: false, error: result.error };
  return { ok: true };
}
