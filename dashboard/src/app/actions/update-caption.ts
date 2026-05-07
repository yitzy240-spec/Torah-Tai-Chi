'use server';

import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';
import type { CaptionField } from '@/lib/platforms';
import { getCanonicalClipPlan } from '@/lib/clip-plan';

interface UpdateCaptionArgs {
  jobId: string;
  /** Which caption field to update. YouTube has two distinct fields
   *  (youtube_title + youtube_description); all other platforms have a
   *  single field that matches the platform name. */
  field: CaptionField;
  text: string;
  parshaSlug?: string;
}

/**
 * Update one caption field inside the canonical clip_plan for the
 * parsha this video belongs to. Each field is stored separately in
 * plan_json.captions, including youtube_title and youtube_description
 * (no flatten/split).
 *
 * Job-tree walk: only run_pipeline inserts a clip_plan row. Compose
 * jobs and per-clip regens reuse the parent's plan and never create
 * their own. So when Yonah is viewing a regen or compose video and
 * hits Save on a caption, a strict eq('job_id', args.jobId) finds
 * nothing and we fail with "No clip plan found for this video" —
 * exactly the bug Yonah hit on Behar after iterating on clips.
 *
 * Mirror of the display-side fallback in /videos/[slug]/page.tsx
 * (commit 5e7765c): pull the parsha_id from the job, list every
 * job for that parsha, then select the most recent clip_plan among
 * them. The original full pipeline's plan stays the source of truth
 * across compose/regen iterations — captions copy doesn't change
 * with renders, so writing to the canonical plan is the right model.
 *
 * Service-role client because RLS on clip_plans is authenticated-all
 * but captions live in plan_json — keeping writes on the service-role
 * side matches our pattern for stance and default_tier.
 */
export async function updateCaption(
  args: UpdateCaptionArgs,
): Promise<{ error?: string }> {
  const sb = createServiceClient();

  const plan = await getCanonicalClipPlan(sb, args.jobId);
  if (!plan) return { error: 'No clip plan found for this video' };

  const captions = {
    ...((plan.planJson.captions as Record<string, string> | undefined) ?? {}),
  };
  captions[args.field] = args.text;
  const newPlan = { ...plan.planJson, captions };

  const { error: updateErr } = await sb
    .from('clip_plans')
    .update({ plan_json: newPlan })
    .eq('id', plan.id);
  if (updateErr) return { error: updateErr.message };

  // Mirror Instagram caption -> videos.website_caption so the public
  // website always reads the latest copy without needing access to
  // clip_plans (which holds internal prompt/structure data). Mirror
  // onto every videos row for this parsha so the website is consistent
  // regardless of which version's videos row it happens to render.
  if (args.field === 'instagram') {
    const { data: jobRow } = await sb
      .from('jobs').select('parsha_id').eq('id', args.jobId).maybeSingle();
    if (jobRow?.parsha_id) {
      const { data: parshaJobs } = await sb
        .from('jobs').select('id').eq('parsha_id', jobRow.parsha_id);
      const allJobIds = (parshaJobs ?? []).map((j) => j.id as string);
      if (allJobIds.length > 0) {
        await sb
          .from('videos')
          .update({ website_caption: args.text })
          .in('job_id', allJobIds);
      }
    }
  }

  if (args.parshaSlug) revalidatePath(`/videos/${args.parshaSlug}`);

  return {};
}
