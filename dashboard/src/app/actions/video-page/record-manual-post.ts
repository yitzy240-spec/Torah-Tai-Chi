'use server';

// Records a native Facebook post the operator published by hand (download
// + paste reel link). Does NOT talk to Buffer. Kept Facebook-only: other
// platforms still go through auto-post.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { parseFacebookPostUrl } from '@/lib/fb-post-url';
import { logEvent } from '@/lib/events';

export async function recordManualPost(
  videoId: string,
  platform: 'facebook',
  caption: string,
  postUrl: string,
  parshaSlug?: string,
): Promise<{ ok: boolean; error?: string; postUrl?: string }> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  if (platform !== 'facebook') {
    return { ok: false, error: 'Manual posting is only set up for Facebook' };
  }

  const parsed = parseFacebookPostUrl(postUrl);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const url = parsed.url;

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { data: existing, error: lookupError } = await supabase
    .from('posts')
    .select('id')
    .eq('video_id', videoId)
    .eq('platform', 'facebook')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) return { ok: false, error: lookupError.message };

  const row = {
    video_id: videoId,
    platform: 'facebook' as const,
    buffer_update_id: null,
    status: 'published',
    scheduled_at: now,
    published_at: now,
    caption,
    post_url: url,
    error_message: null,
  };

  if (existing?.id) {
    const { error } = await supabase.from('posts').update(row).eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from('posts').insert(row);
    if (error) return { ok: false, error: error.message };
  }

  const { data: vRow } = await supabase
    .from('videos')
    .select('post_urls')
    .eq('id', videoId)
    .maybeSingle();
  const merged: Record<string, string> = {
    ...((vRow?.post_urls as Record<string, string> | null) ?? {}),
    facebook: url,
  };
  const { error: mergeError } = await supabase
    .from('videos')
    .update({ post_urls: merged })
    .eq('id', videoId);
  if (mergeError) return { ok: false, error: mergeError.message };

  await logEvent({
    actor: 'yonah',
    level: 'action',
    event: 'post.facebook.manual',
    subjectType: 'video',
    subjectId: videoId,
    message: 'Recorded a native Facebook post',
    details: { postUrl: url, updatedExisting: Boolean(existing?.id) },
  });

  if (parshaSlug) {
    revalidatePath(`/videos/${parshaSlug}`);
  }

  return { ok: true, postUrl: url };
}
