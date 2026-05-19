'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Clone the source script into a fresh draft row, creating a Phase 1
 * starting point for a "replace this live version" flow.
 *
 * Auth-checks via the user cookie; writes via service role because the
 * scripts table only has an "authed read" RLS policy (same pattern as
 * add-move-to-script.ts). Does NOT touch videos.published_to_website —
 * the live version stays live until the user publishes the new draft.
 *
 * Returns { scriptId } so the caller can navigate to Phase 1 with the
 * new draft pre-loaded.
 */
export async function replaceVersion(
  parshaId: string,
  sourceScriptId: string,
  parshaSlug: string,
): Promise<{ scriptId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const svc = createServiceClient();

  // Read the source script's text + metadata so the new draft starts pre-loaded.
  const { data: src, error: srcErr } = await svc
    .from('scripts')
    .select('option, title, tldr, draft_text, director_notes, motion_ref_slug')
    .eq('id', sourceScriptId)
    .single();
  if (srcErr || !src) throw new Error(srcErr?.message ?? 'Source script not found');

  // Insert a fresh draft row with the same text. Always option='A-tight' so it
  // sorts to the top of the script carousel in Phase 1.
  const { data: fresh, error: insertErr } = await svc
    .from('scripts')
    .insert({
      parsha_id: parshaId,
      option: 'A-tight',
      title: src.title,
      tldr: src.tldr,
      draft_text: src.draft_text,
      director_notes: src.director_notes,
      motion_ref_slug: src.motion_ref_slug,
    })
    .select('id')
    .single();
  if (insertErr || !fresh) throw new Error(insertErr?.message ?? 'Could not create fresh draft script');

  revalidatePath('/', 'layout');
  revalidatePath(`/videos/${parshaSlug}`, 'layout');

  return { scriptId: fresh.id };
}
