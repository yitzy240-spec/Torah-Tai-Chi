'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Persist (or clear) the per-clip motion reference slug on a clip row.
 *
 * Pass motionRefSlug=null to remove the selection. Validates the slug
 * against tai_chi_moves so we never persist an orphan.
 *
 * Auth-checks via the user cookie; writes via service role because the
 * clips table only has an "authed read" RLS policy — authenticated
 * UPDATEs would silently match zero rows. Mirrors addMoveToScript pattern.
 */
export async function savePlanClipMotion(
  clipId: string,
  motionRefSlug: string | null,
  parshaSlug?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const svc = createServiceClient();

  if (motionRefSlug !== null) {
    const { data: move } = await svc
      .from('tai_chi_moves')
      .select('slug')
      .eq('slug', motionRefSlug)
      .maybeSingle();
    if (!move) return { ok: false, error: `Unknown move: ${motionRefSlug}` };
  }

  const { error } = await svc
    .from('clips')
    .update({ motion_ref_slug: motionRefSlug })
    .eq('id', clipId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  if (parshaSlug) revalidatePath(`/videos/${parshaSlug}`, 'layout');

  return { ok: true };
}
