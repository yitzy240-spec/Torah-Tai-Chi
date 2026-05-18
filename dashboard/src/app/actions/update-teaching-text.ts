'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Update the public-facing teaching text (videos.spoken_script) for a
 * single video. This is the text shown under "THE TEACHING" on the
 * parsha page on torahtaichi.com.
 *
 * Use case: Yonah notices a typo or awkward phrasing after publishing
 * and wants a fast fix without going through a re-render cycle. The
 * publish action no longer overwrites spoken_script when it's already
 * set (commit 789d76b), so manual edits survive across (un)publish
 * toggles.
 */
export async function updateTeachingText(args: {
  videoId: string;
  text: string;
  parshaSlug?: string;
}): Promise<{ ok: true } | { error: string }> {
  const text = (args.text ?? '').trim();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error, data } = await supabase
    .from('videos')
    .update({ spoken_script: text })
    .eq('id', args.videoId)
    .select('id')
    .single();
  if (error) return { error: error.message };
  if (!data) return { error: 'Video not found' };

  // Dashboard revalidation (server component cache).
  if (args.parshaSlug) revalidatePath(`/videos/${args.parshaSlug}`);

  // Bust the public website's ISR cache. Fire-and-forget — failures
  // here shouldn't block the save; the website's 60 s ISR will catch
  // up regardless.
  if (args.parshaSlug) {
    const websiteUrl = process.env.WEBSITE_REVALIDATE_URL;
    const websiteSecret = process.env.WEBSITE_REVALIDATE_SECRET
      ?? process.env.STORYBLOK_WEBHOOK_SECRET;
    if (websiteUrl && websiteSecret) {
      const hit = (full_slug: string) => fetch(websiteUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-signature': websiteSecret,
        },
        body: JSON.stringify({ full_slug }),
        signal: AbortSignal.timeout(5000),
      }).catch((e) => {
        console.warn(`[updateTeachingText] website revalidate ${full_slug} failed:`, e);
      });
      await Promise.all([hit(`videos/${args.parshaSlug}`), hit('')]);
    }
  }

  return { ok: true };
}
