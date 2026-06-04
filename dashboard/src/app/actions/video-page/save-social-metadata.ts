'use server';

// Writes clip_plans.social_metadata (JSONB) and/or clip_plans.youtube_tags (text[]).
// social_metadata shape: { instagram?: { type, firstComment? }, facebook?: { type, firstComment? } }
// youtube_tags replaces the hardcoded ['Torah', 'Tai Chi', 'Shorts'] in auto-post.ts.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCanonicalClipPlan } from '@/lib/clip-plan';
import { revalidatePath } from 'next/cache';

export async function saveSocialMetadata(
  jobId: string,
  patch: {
    social_metadata?: Record<string, unknown>;
    youtube_tags?: string[];
  },
  parshaSlug?: string,
): Promise<void> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const supabase = createServiceClient();
  const plan = await getCanonicalClipPlan(supabase, jobId);
  if (!plan) throw new Error('No clip plan found for job');

  const update: Record<string, unknown> = {};
  if (patch.social_metadata !== undefined) update.social_metadata = patch.social_metadata;
  if (patch.youtube_tags !== undefined) update.youtube_tags = patch.youtube_tags;

  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from('clip_plans')
    .update(update)
    .eq('id', plan.id);

  if (error) throw new Error(`saveSocialMetadata: ${error.message}`);

  // Narrow revalidation to just this video page. The previous
  // revalidatePath('/', 'layout') ran on every Reel/Post toggle and
  // YouTube-tags blur, busting the buffer-* unstable_cache tags. See
  // save-platform-caption.ts for the full writeup of the Buffer
  // rate-limit bug this was causing.
  if (parshaSlug) {
    revalidatePath(`/videos/${parshaSlug}`);
  }
}
