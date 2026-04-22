'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Persist (or clear) the motion reference slug on a script row.
 *
 * Pass slug=null to remove a selection. Validates the slug against
 * tai_chi_moves so we never persist an orphan.
 *
 * Auth-checks via the user cookie; writes via service role because the
 * scripts table only has an "authed read" RLS policy — authenticated
 * UPDATEs would silently match zero rows. Same pattern as saveScriptDraft.
 */
export async function addMoveToScript({
  scriptId,
  slug,
  parshaSlug,
}: {
  scriptId: string;
  slug: string | null;
  /** Optional — used to revalidate the videos/[slug] detail page. */
  parshaSlug?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const svc = createServiceClient();

  if (slug !== null) {
    const { data: move } = await svc
      .from('tai_chi_moves')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();
    if (!move) return { ok: false, error: `Unknown move: ${slug}` };
  }

  const { error } = await svc
    .from('scripts')
    .update({ motion_ref_slug: slug })
    .eq('id', scriptId);
  if (error) return { ok: false, error: error.message };

  // Use layout-scope revalidation so Next's Full Route Cache is busted
  // cascadingly — page-scope alone wasn't reliably propagating in N16.
  revalidatePath('/', 'layout');
  if (parshaSlug) revalidatePath(`/videos/${parshaSlug}`, 'layout');

  return { ok: true };
}
