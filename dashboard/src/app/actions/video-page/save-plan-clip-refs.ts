'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const MAX_REF_IMAGES = 9;

/**
 * Persist (or clear) per-clip reference_image_paths on a clip row.
 *
 * Pass paths=null to revert to auto-select (the Modal pipeline's default
 * char/dojo/jewish logic). Pass an array to override — the array is capped
 * at MAX_REF_IMAGES (9) per Seedance constraints.
 *
 * Auth-checks via user cookie; writes via service role. Mirrors the
 * save-plan-clip-motion pattern.
 *
 * Cache: NO revalidatePath. See save-plan-clip-motion.ts for the full
 * explanation — keystroke-frequency autosave + layout-scope revalidate
 * was busting the buffer-profiles / buffer-post-links unstable_cache
 * tags and burning Yonah's daily Buffer rate limit. The phase-2 editor
 * subscribes to clips row changes via useRealtimeRow for canonical-state
 * refresh. parshaSlug arg is preserved for caller compatibility but ignored.
 */
export async function savePlanClipRefs(
  clipId: string,
  paths: string[] | null,
  _parshaSlug?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  if (paths !== null && paths.length > MAX_REF_IMAGES) {
    return {
      ok: false,
      error: `Cannot set more than ${MAX_REF_IMAGES} reference images per clip.`,
    };
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from('clips')
    .update({ reference_image_paths: paths })
    .eq('id', clipId);

  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
