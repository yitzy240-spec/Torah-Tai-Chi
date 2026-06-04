'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Persist draft_text onto a script row.
 *
 * Auth-checks via the user cookie; writes via service role because the
 * scripts table only has an "authed read" RLS policy — authenticated
 * UPDATEs would silently match zero rows. Same pattern as addMoveToScript.
 *
 * Cache: narrow revalidatePath to just this video page. The previous
 * revalidatePath('/', 'layout') ran on every keystroke (Phase 1
 * EditableField → useOptimisticSave with no debounce). That busted the
 * entire Next.js data cache including the unstable_cache entries tagged
 * `buffer-profiles` and `buffer-post-links`, so the next render of
 * /videos/[slug] re-fetched Buffer. Same root cause as the caption
 * autosave issue — see save-platform-caption.ts for the full writeup.
 */
export async function saveScript(
  scriptId: string,
  draftText: string,
  parshaSlug?: string,
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const svc = createServiceClient();
  const { error } = await svc
    .from('scripts')
    .update({ draft_text: draftText })
    .eq('id', scriptId);
  if (error) throw new Error(error.message);

  if (parshaSlug) {
    revalidatePath(`/videos/${parshaSlug}`);
  }
}
