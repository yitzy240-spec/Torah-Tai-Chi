'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const MAX_TITLE_CHARS = 100;
const MAX_TLDR_CHARS = 300;

/**
 * Saves user-edited title and/or tldr to the scripts row. These fields
 * drive the dashboard script-card header AND the public website's video
 * detail page. They do NOT affect Seedance generation.
 */
export async function updateScriptMeta(opts: {
  scriptId: string;
  title?: string | null;
  tldr?: string | null;
  parshaSlug?: string;
}): Promise<{ ok: true } | { error: string }> {
  const { scriptId, title, tldr, parshaSlug } = opts;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const update: Record<string, string | null> = {};
  if (title !== undefined) {
    const trimmed = (title ?? '').trim();
    if (trimmed.length > MAX_TITLE_CHARS) {
      return { error: `Title too long (max ${MAX_TITLE_CHARS} chars)` };
    }
    update.title = trimmed === '' ? null : trimmed;
  }
  if (tldr !== undefined) {
    const trimmed = (tldr ?? '').trim();
    if (trimmed.length > MAX_TLDR_CHARS) {
      return { error: `Teaser too long (max ${MAX_TLDR_CHARS} chars)` };
    }
    update.tldr = trimmed === '' ? null : trimmed;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const { error } = await supabase.from('scripts').update(update).eq('id', scriptId);
  if (error) return { error: error.message };

  // Revalidate the parsha page so the public website also reflects the change.
  if (parshaSlug) {
    revalidatePath(`/videos/${parshaSlug}`);
  }
  return { ok: true };
}
