'use server';
import { createClient } from '@/lib/supabase/server';

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
    if (voiceover.length > MAX_VOICEOVER_CHARS) {
      return { error: `Voiceover too long (max ${MAX_VOICEOVER_CHARS} chars)` };
    }
    update.voiceover = voiceover;
  }
  if (visualPrompt !== undefined) {
    if (visualPrompt.length > MAX_VISUAL_PROMPT_CHARS) {
      return { error: `Scene direction too long (max ${MAX_VISUAL_PROMPT_CHARS} chars)` };
    }
    update.visual_prompt = visualPrompt;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const { error } = await supabase.from('clips').update(update).eq('id', clipId);
  if (error) return { error: error.message };
  return { ok: true };
}
