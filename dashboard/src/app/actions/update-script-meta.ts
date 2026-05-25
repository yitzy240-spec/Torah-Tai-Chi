'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const MAX_TITLE_CHARS = 100;
const MAX_TLDR_CHARS = 300;

/**
 * Saves user-edited title and/or tldr to the scripts row. These fields
 * drive the dashboard script-card header AND the public website's video
 * detail page. They do NOT affect Seedance generation.
 *
 * Auth-check via the cookie client, but the actual write uses the
 * service-role client — RLS on `scripts` does not grant UPDATE to
 * `authenticated`, only `service_role`. Yonah's 2026-05-17 bug:
 * inline-edit on the Shavuot script title showed "saved" but reverted
 * to the old value on refresh. Root cause: the auth-client `.update()`
 * silently no-op'd (zero rows affected, no error) because RLS denied
 * the write. The action returned `{ ok: true }` because supabase-js
 * doesn't surface zero-rows-affected as an error.
 *
 * Mirrors save-script-draft.ts which uses the same auth-then-service
 * pattern.
 *
 * Additional defense: the update now chains `.select('id')` so we know
 * how many rows the write touched. If zero, return an explicit error
 * — that catches future silent-RLS-block bugs at write time rather
 * than letting the user see "saved" and watch the value revert.
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

  // Service role write — RLS on `scripts` only allows authed reads.
  // `.select('id')` so a 0-row update surfaces an explicit not-found
  // error instead of silently returning ok.
  const svc = createServiceClient();
  const { data: affected, error } = await svc
    .from('scripts')
    .update(update)
    .eq('id', scriptId)
    .select('id');
  if (error) return { error: error.message };
  if (!affected || affected.length === 0) {
    return { error: `Script ${scriptId} not found (or update was blocked).` };
  }

  // Revalidate the dashboard's own parsha page so the next render sees
  // the updated title/tldr immediately. Also revalidate the homepage
  // because the script title shows under the embedded "this week"
  // video there. The PUBLIC website (separate Next.js project at
  // website/) has its own ISR cache and needs a separate manual purge.
  if (parshaSlug) {
    revalidatePath(`/videos/${parshaSlug}`);
  }
  revalidatePath('/');
  return { ok: true };
}
