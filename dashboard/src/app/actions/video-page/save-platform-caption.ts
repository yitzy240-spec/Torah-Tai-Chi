'use server';

// Writes one platform's caption into clip_plans.plan_json.captions.
// The flat string remains canonical for Buffer's text field.
// See spec §11.2 — must go through getCanonicalClipPlan (not a direct eq job_id lookup).

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCanonicalClipPlan } from '@/lib/clip-plan';
import { revalidatePath } from 'next/cache';

export async function savePlatformCaption(
  jobId: string,
  platform: string,
  text: string,
): Promise<void> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const supabase = createServiceClient();
  const plan = await getCanonicalClipPlan(supabase, jobId);
  if (!plan) throw new Error('No clip plan found for job');

  // Merge the new caption into the existing captions map inside plan_json.
  const planJson = plan.planJson as Record<string, unknown>;
  const existingCaptions = (planJson.captions as Record<string, string> | undefined) ?? {};
  const updatedCaptions = { ...existingCaptions, [platform]: text };
  const updatedPlanJson = { ...planJson, captions: updatedCaptions };

  const { error } = await supabase
    .from('clip_plans')
    .update({ plan_json: updatedPlanJson })
    .eq('id', plan.id);

  if (error) throw new Error(`savePlatformCaption: ${error.message}`);
  revalidatePath('/', 'layout');
}
