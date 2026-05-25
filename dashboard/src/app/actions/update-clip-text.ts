'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const MAX_VOICEOVER_CHARS = 1500;
const MAX_VISUAL_PROMPT_CHARS = 5000;

/**
 * Saves user-edited voiceover and/or visual_prompt to the clips row.
 * The stored values are what regen_clip_from_text reads when the user
 * clicks Re-render — so this is the single point of write for "the
 * exact text Seedance will see on the next render."
 *
 * Either field can be omitted to leave it unchanged. If both are
 * provided, both are written in one update.
 */
export async function updateClipText(opts: {
  clipId: string;
  voiceover?: string;
  visualPrompt?: string;
}): Promise<{ ok: true } | { error: string }> {
  const { clipId, voiceover, visualPrompt } = opts;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const update: Record<string, string> = {};
  if (voiceover !== undefined) {
    // clips.voiceover is NOT NULL — empty/whitespace-only would either
    // violate the constraint or, worse, succeed and have Modal render a
    // silent clip. Reject before write. Don't trim before saving — the
    // user may want trailing whitespace/punctuation preserved verbatim.
    if (voiceover.trim().length === 0) {
      return { error: 'Voiceover cannot be empty.' };
    }
    if (voiceover.length > MAX_VOICEOVER_CHARS) {
      return { error: `Voiceover too long (max ${MAX_VOICEOVER_CHARS} chars)` };
    }
    update.voiceover = voiceover;
  }
  if (visualPrompt !== undefined) {
    // Same reasoning as voiceover above — clips.visual_prompt is NOT
    // NULL and an empty string would silently break the next regen.
    if (visualPrompt.trim().length === 0) {
      return { error: 'Scene direction cannot be empty.' };
    }
    if (visualPrompt.length > MAX_VISUAL_PROMPT_CHARS) {
      return { error: `Scene direction too long (max ${MAX_VISUAL_PROMPT_CHARS} chars)` };
    }
    update.visual_prompt = visualPrompt;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  // Service role write — RLS on `clips` only allows authed reads, not
  // authed writes. `.select('id')` returns the array of affected rows so
  // we can detect zero-row writes (stale clipId, dropped row) and surface
  // an explicit error instead of returning ok with nothing written.
  // Same shape as update-script-meta.ts.
  const svc = createServiceClient();
  const { data: affected, error } = await svc
    .from('clips')
    .update(update)
    .eq('id', clipId)
    .select('id');
  if (error) return { error: error.message };
  if (!affected || affected.length === 0) {
    return { error: `Clip ${clipId} not found (or update was blocked).` };
  }
  return { ok: true };
}
