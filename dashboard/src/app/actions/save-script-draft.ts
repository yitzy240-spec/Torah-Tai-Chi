'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logEvent } from '@/lib/events';
import { revalidatePath } from 'next/cache';

const DIRECTOR_NOTES_MAX_CHARS = 1000;

/**
 * Save edits to a script's draft_text (and optionally title/tldr/director_notes).
 * Auth-checks the session cookie; writes via service-role to bypass RLS.
 *
 * directorNotes semantics:
 *  - undefined  → don't touch the column
 *  - ""         → explicit clear, persists as null
 *  - non-empty  → trimmed, max 1000 chars
 */
export async function saveScriptDraft(args: {
  scriptId: string;
  draftText: string;
  title?: string;
  tldr?: string;
  directorNotes?: string;
  parshaSlug?: string; // for path revalidation
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const draft = args.draftText.trim();
  if (!draft) return { ok: false, error: 'Draft text cannot be empty' };

  const svc = createServiceClient();
  const patch: Record<string, string | null> = { draft_text: draft };
  if (args.title !== undefined) patch.title = args.title.trim();
  if (args.tldr !== undefined) patch.tldr = args.tldr.trim();
  if (args.directorNotes !== undefined) {
    const trimmed = args.directorNotes.trim();
    if (trimmed.length > DIRECTOR_NOTES_MAX_CHARS) {
      return { ok: false, error: `Director notes too long (max ${DIRECTOR_NOTES_MAX_CHARS} chars)` };
    }
    patch.director_notes = trimmed === '' ? null : trimmed;
  }

  const { error } = await svc.from('scripts').update(patch).eq('id', args.scriptId);
  if (error) {
    await logEvent({
      actor: 'yonah',
      level: 'error',
      event: 'script.draft.error',
      subjectType: 'script',
      subjectId: args.scriptId,
      message: `Script draft save failed: ${error.message}`,
      details: { parshaSlug: args.parshaSlug, error: error.message },
    });
    return { ok: false, error: error.message };
  }

  await logEvent({
    actor: 'yonah',
    level: 'action',
    event: 'script.draft.saved',
    subjectType: 'script',
    subjectId: args.scriptId,
    message: 'Script draft saved',
    details: {
      parshaSlug: args.parshaSlug,
      draftLength: draft.length,
      titleChanged: args.title !== undefined,
      tldrChanged: args.tldr !== undefined,
      directorNotesChanged: args.directorNotes !== undefined,
      actorUserId: user.id,
    },
  });

  if (args.parshaSlug) revalidatePath(`/videos/${args.parshaSlug}`);
  revalidatePath('/');
  return { ok: true };
}
