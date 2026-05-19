'use server';

// Flushes all 5 site CMS fields in one call and triggers website ISR revalidation.
// Called by the "Publish changes" button on the live-at-rest page.
// Each EditableField already calls saveSiteField on its own (optimistic per-field
// saves), so this is a final safety flush + cache bust to make changes live
// on torahtaichi.com immediately.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';
import { revalidateWebsite } from '@/lib/revalidate-website';

type SiteFields = {
  title: string;
  subtitle: string;
  description: string;
  website_caption: string;
  spoken_script: string;
};

export async function publishSiteChanges(
  videoId: string,
  parshaSlug: string,
  fields: SiteFields,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('videos')
    .update({
      title: fields.title,
      subtitle: fields.subtitle,
      description: fields.description,
      website_caption: fields.website_caption,
      spoken_script: fields.spoken_script,
    })
    .eq('id', videoId);

  if (error) return { ok: false, error: error.message };

  // Bust the dashboard cache
  revalidatePath('/', 'layout');
  revalidatePath(`/videos/${parshaSlug}`, 'layout');

  // Bust the public website ISR cache — fire-and-forget so a slow
  // revalidate endpoint doesn't block the publish response.
  void Promise.all([
    revalidateWebsite(`videos/${parshaSlug}`),
    revalidateWebsite(''),
  ]);

  return { ok: true };
}
