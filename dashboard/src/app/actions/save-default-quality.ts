'use server';
import { createClient } from '@/lib/supabase/server';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';

export async function saveDefaultQuality(
  resolution: Resolution,
  tier: ModelTier,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const value = `${resolution} ${tier}`;

  const { error } = await supabase
    .from('site_content')
    .upsert(
      { key: 'settings.default_tier', value, description: 'Default quality tier for video generation' },
      { onConflict: 'key' },
    );

  if (error) return { error: error.message };
  return {};
}
