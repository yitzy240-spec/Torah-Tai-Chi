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
  revalidatePath('/', 'layout');
}
