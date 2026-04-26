'use server';

import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';
import type { Platform } from '@/lib/platforms';

interface UpdateCaptionArgs {
  jobId: string;
  platform: Platform;
  text: string;
  parshaSlug?: string;
}

/**
 * Update one platform's caption inside the latest clip_plan for a job.
 * YouTube is special: the UI edits the joined "title\ndescription" string,
 * so we split on the first newline and write back youtube_title +
 * youtube_description (matches the shape Modal originally writes).
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

  if (args.platform === 'youtube') {
    const idx = args.text.indexOf('\n');
    if (idx === -1) {
      captions.youtube_title = args.text;
      captions.youtube_description = '';
    } else {
      captions.youtube_title = args.text.slice(0, idx);
      captions.youtube_description = args.text.slice(idx + 1);
    }
  } else {
    captions[args.platform] = args.text;
  }

  const newPlan = { ...planJson, captions };

  const { error: updateErr } = await sb
    .from('clip_plans')
    .update({ plan_json: newPlan })
    .eq('id', planRow.id);

  if (updateErr) return { error: updateErr.message };

  // Mirror Instagram caption -> videos.website_caption so the public
  // website always reads the latest copy without needing access to
  // clip_plans (which holds internal prompt/structure data).
  if (args.platform === 'instagram') {
    await sb
      .from('videos')
      .update({ website_caption: args.text })
      .eq('job_id', args.jobId);
  }

  if (args.parshaSlug) revalidatePath(`/videos/${args.parshaSlug}`);

  return {};
}
