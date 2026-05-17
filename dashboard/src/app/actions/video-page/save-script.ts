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
 */
export async function saveScript(scriptId: string, draftText: string): Promise<void> {
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

  revalidatePath('/', 'layout');
}
