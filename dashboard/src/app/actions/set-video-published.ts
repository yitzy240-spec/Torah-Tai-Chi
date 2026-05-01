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
 * Invariant: at most ONE video per parsha is published at a time. When
 * setting published=true, any other video for the same parsha that is
 * currently published gets unpublished first. This stops the website
 * from showing two competing takes of the same parsha (e.g. when Yonah
 * publishes a freshly-composed v5 of Emor, the previously-live v2
 * comes down automatically).
 *
 * Service-role write because the existing 'authed all videos' policy
 * applies to authenticated users — but the publish gate is a
 * site-management action and we want it to bypass RLS quirks.
 */
export async function setVideoPublished(
  videoId: string,
  publishedToWebsite: boolean,
  parshaSlug?: string,
): Promise<{ error?: string; replacedVideoIds?: string[] }> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const sb = createServiceClient();

  let replacedVideoIds: string[] = [];

  if (publishedToWebsite) {
    // Resolve the parsha_id for this video by walking through its job.
    const { data: videoRow, error: vErr } = await sb
      .from('videos')
      .select('id, job_id')
      .eq('id', videoId)
      .single();
    if (vErr || !videoRow) {
      return { error: vErr?.message ?? 'Video not found' };
    }
    const { data: jobRow, error: jErr } = await sb
      .from('jobs')
      .select('parsha_id')
      .eq('id', videoRow.job_id as string)
      .single();
    if (jErr || !jobRow) {
      return { error: jErr?.message ?? 'Job not found for video' };
    }
    const parshaId = jobRow.parsha_id as string | null;

    // If this video belongs to a parsha, unpublish any sibling videos
    // that are currently live. We do this even if no siblings exist —
    // the eq() filter just no-ops in that case.
    if (parshaId) {
      const { data: siblingJobs } = await sb
        .from('jobs')
        .select('id')
        .eq('parsha_id', parshaId);
      const siblingJobIds = (siblingJobs ?? []).map(
        (j: { id: string }) => j.id,
      );
      if (siblingJobIds.length > 0) {
        const { data: replaced } = await sb
          .from('videos')
          .update({ published_to_website: false })
          .in('job_id', siblingJobIds)
          .neq('id', videoId)
          .eq('published_to_website', true)
          .select('id');
        replacedVideoIds = (replaced ?? []).map(
          (v: { id: string }) => v.id as string,
        );
      }
    }
  }

  const { error } = await sb
    .from('videos')
    .update({ published_to_website: publishedToWebsite })
    .eq('id', videoId);
  if (error) return { error: error.message };

  if (parshaSlug) revalidatePath(`/videos/${parshaSlug}`);
  revalidatePath('/');

  return { replacedVideoIds };
}
