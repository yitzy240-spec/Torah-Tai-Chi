'use server';

import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';
import type { CaptionField } from '@/lib/platforms';

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
 * Update one caption field inside the latest clip_plan for a job.
 * Each field is stored separately in plan_json.captions, including
 * youtube_title and youtube_description (no flatten/split).
 *
 * Service-role client because RLS on clip_plans is authenticated-all but
 * captions live in plan_json — keeping writes on the service-role side
 * matches our pattern for stance and default_tier.
 */
export async function updateCaption(
  args: UpdateCaptionArgs,
): Promise<{ error?: string }> {
  const sb = createServiceClient();

  const { data: planRow, error: fetchErr } = await sb
    .from('clip_plans')
    .select('id, plan_json')
    .eq('job_id', args.jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!planRow) return { error: 'No clip plan found for this video' };

  const planJson = (planRow.plan_json ?? {}) as Record<string, unknown>;
  const captions = { ...((planJson.captions as Record<string, string>) ?? {}) };
  captions[args.field] = args.text;

  const newPlan = { ...planJson, captions };

  const { error: updateErr } = await sb
    .from('clip_plans')
    .update({ plan_json: newPlan })
    .eq('id', planRow.id);

  if (updateErr) return { error: updateErr.message };

  // Mirror Instagram caption -> videos.website_caption so the public
  // website always reads the latest copy without needing access to
  // clip_plans (which holds internal prompt/structure data).
  if (args.field === 'instagram') {
    await sb
      .from('videos')
      .update({ website_caption: args.text })
      .eq('job_id', args.jobId);
  }

  if (args.parshaSlug) revalidatePath(`/videos/${args.parshaSlug}`);

  return {};
}
