'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';
import { getCanonicalClipPlan } from '@/lib/clip-plan';

/**
 * Toggle whether a video is visible on the public website. Backed by
 * videos.published_to_website (bool, default false). Anon RLS on
 * torahtaichi.com filters unpublished rows out, so this is the single
 * gate Yonah controls before a video goes live.
 *
 * Invariants:
 *   1. At most ONE video per parsha is published at a time. Sibling
 *      versions are unpublished automatically before the new one goes
 *      live, so the public site never has two competing takes.
 *   2. When publishing, snapshot the clip-plan voiceovers into
 *      videos.spoken_script. The website renders that text on the video
 *      page; without the snapshot it would show the original script,
 *      which can drift from per-clip-edited regens.
 *   3. Bust the public website's ISR cache so the publish/unpublish
 *      reflects immediately instead of waiting up to 60 s.
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
    const jobId = videoRow.job_id as string;
    const { data: jobRow, error: jErr } = await sb
      .from('jobs')
      .select('parsha_id')
      .eq('id', jobId)
      .single();
    if (jErr || !jobRow) {
      return { error: jErr?.message ?? 'Job not found for video' };
    }
    const parshaId = jobRow.parsha_id as string | null;

    // If this video belongs to a parsha, unpublish any sibling videos
    // that are currently live.
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

    // Only snapshot a spoken_script if the video doesn't already have
    // one. Modal sets videos.spoken_script at every stitch point from
    // the clips actually composed (via _build_spoken_script, which
    // already strips phonetic guides per clip). Overwriting that with
    // plan_json.full_script silently discarded every per-clip edit
    // Yonah made via the editor — Yonah hit this on 2026-05-18 Shavuot:
    // the public site showed the original A-tight script instead of
    // his cleaned-up clip text. Legacy videos (pre-stitch-time
    // spoken_script) still need the snapshot from clip_plan, so we
    // only fill in when null/empty.
    const { data: existing } = await sb
      .from('videos').select('spoken_script').eq('id', videoId).single();
    const hasSpoken = !!(existing?.spoken_script as string | null | undefined)?.trim();
    if (!hasSpoken) {
      const plan = await getCanonicalClipPlan(sb, jobId);
      const planJson = (plan?.planJson ?? {}) as { full_script?: string };
      const cleanScript = (planJson.full_script ?? '').trim();
      if (cleanScript) {
        await sb
          .from('videos')
          .update({ spoken_script: cleanScript })
          .eq('id', videoId);
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

  // Bust the public website's ISR cache. Fire-and-forget — failures
  // here shouldn't block the publish (the website will catch up on its
  // 60 s ISR window even if this call fails).
  if (parshaSlug) {
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
        console.warn(
          `[setVideoPublished] website revalidate ${full_slug} failed:`, e,
        );
      });
      // Both the parsha video page and the homepage list need to refresh.
      await Promise.all([hit(`videos/${parshaSlug}`), hit('')]);
    }
  }

  return { replacedVideoIds };
}
