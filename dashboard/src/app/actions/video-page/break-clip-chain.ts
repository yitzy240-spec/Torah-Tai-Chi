'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Set (or clear) the chain_broken flag on a clip.
 *
 * When chain_broken = true, the Modal pipeline skips first-frame chaining
 * for this clip even if its setting_id matches the previous clip. This
 * allows reference images to flow in even for mid-scene clips.
 *
 * Pass broken=false to restore automatic chain logic.
 *
 * Auth-checks via user cookie; writes via service role (clips table has
 * "authed read" RLS only). Mirrors save-plan-clip-motion pattern.
 */
export async function breakClipChain(
  clipId: string,
  broken: boolean,
  parshaSlug?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const svc = createServiceClient();
  const { error } = await svc
    .from('clips')
    .update({ chain_broken: broken })
    .eq('id', clipId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  if (parshaSlug) revalidatePath(`/videos/${parshaSlug}`, 'layout');

  return { ok: true };
}
