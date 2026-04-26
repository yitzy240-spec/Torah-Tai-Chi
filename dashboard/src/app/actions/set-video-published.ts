'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Toggle whether a video is visible on the public website. Backed by
 * videos.published_to_website (bool, default false). Anon RLS on
 * torahtaichi.com filters unpublished rows out, so this is the single
 * gate Yonah controls before a video goes live.
 *
 * Service-role write because the existing 'authed all videos' policy
 * applies to authenticated users — but the publish gate is a
 * site-management action and we want it to bypass RLS quirks.
 */
export async function setVideoPublished(
  videoId: string,
  publishedToWebsite: boolean,
  parshaSlug?: string,
): Promise<{ error?: string }> {
  // Require an authenticated dashboard session before letting anyone
  // change visibility.
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const sb = createServiceClient();
  const { error } = await sb
    .from('videos')
    .update({ published_to_website: publishedToWebsite })
    .eq('id', videoId);

  if (error) return { error: error.message };

  if (parshaSlug) revalidatePath(`/videos/${parshaSlug}`);
  revalidatePath('/');

  return {};
}
