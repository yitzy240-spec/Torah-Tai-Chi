'use server';

// Writes videos.{title|subtitle|description|website_caption|spoken_script} for the Site card.
// These columns were added in migration 0099_video_page_redesign.sql (title/subtitle/description)
// and already existed (website_caption, spoken_script).

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

export async function saveSiteField(
  videoId: string,
  field: 'title' | 'subtitle' | 'description' | 'website_caption' | 'spoken_script',
  value: string,
): Promise<void> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('videos')
    .update({ [field]: value })
    .eq('id', videoId);

  if (error) throw new Error(`saveSiteField(${field}): ${error.message}`);

  // Narrow the revalidation scope. This action runs on every per-field
  // optimistic save (5 fields × debounced typing = many calls). The old
  // revalidatePath('/', 'layout') was a full-app cache bust on each call.
  //
  // Look up the parsha slug via videos → jobs → parshiot and revalidate
  // just the operator's video page + the dashboard root (where the parsha
  // tile shows draft/live state). Public website (torahtaichi.com) ISR is
  // not busted here — that's publishSiteChanges' job, fired by the
  // explicit "Publish changes" CTA.
  const { data: videoRow } = await supabase
    .from('videos')
    .select('job_id')
    .eq('id', videoId)
    .single();
  const jobId = videoRow?.job_id as string | undefined;
  let parshaSlug: string | null = null;
  if (jobId) {
    const { data: jobRow } = await supabase
      .from('jobs')
      .select('parsha_id')
      .eq('id', jobId)
      .single();
    const parshaId = jobRow?.parsha_id as string | null | undefined;
    if (parshaId) {
      const { data: parshaRow } = await supabase
        .from('parshiot')
        .select('slug')
        .eq('id', parshaId)
        .single();
      parshaSlug = (parshaRow?.slug as string | undefined) ?? null;
    }
  }

  if (parshaSlug) revalidatePath(`/videos/${parshaSlug}`);
  revalidatePath('/');
}
