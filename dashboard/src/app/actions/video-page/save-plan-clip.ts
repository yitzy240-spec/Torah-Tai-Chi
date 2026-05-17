'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Persist voiceover and/or visual_prompt edits onto a single clip row.
 *
 * Auth-checks via the user cookie; writes via service role because the
 * clips table only has an "authed read" RLS policy (same pattern as
 * addMoveToScript / saveScript).
 */
export async function savePlanClip(
  clipId: string,
  patch: { voiceover?: string; visual_prompt?: string },
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const svc = createServiceClient();
  const { error } = await svc.from('clips').update(patch).eq('id', clipId);
  if (error) throw new Error(error.message);

  revalidatePath('/', 'layout');
}
