'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Persist (or clear) the per-clip motion reference slug on a clip row.
 *
 * Pass motionRefSlug=null to remove the selection. Validates the slug
 * against tai_chi_moves so we never persist an orphan.
 *
 * Auth-checks via the user cookie; writes via service role because the
 * clips table only has an "authed read" RLS policy — authenticated
 * UPDATEs would silently match zero rows. Mirrors addMoveToScript pattern.
 *
 * Cache: NO revalidatePath. This action is fired on every keystroke by
 * useOptimisticSave (no debounce) in the phase-2 plan-review editor. A
 * revalidatePath('/', 'layout') here would bust the Next.js data cache —
 * including the unstable_cache entries tagged `buffer-profiles` and
 * `buffer-post-links` — and the next render of /videos/[slug] would
 * re-fetch Buffer. That blew Yonah's 100/day Buffer rate limit and
 * triggered recurring 24h bans. The phase-2 editor already subscribes
 * to clips row changes via useRealtimeRow, so the canonical-state
 * refresh that revalidatePath used to handle is now driven by Realtime.
 * parshaSlug arg is preserved for caller compatibility but ignored.
 */
export async function savePlanClipMotion(
  clipId: string,
  motionRefSlug: string | null,
  _parshaSlug?: string,
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

  return { ok: true };
}
