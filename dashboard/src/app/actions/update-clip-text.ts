'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const MAX_VOICEOVER_CHARS = 1500;
const MAX_VISUAL_PROMPT_CHARS = 5000;
const DURATION_MIN_S = 1;
const DURATION_MAX_S = 60;

/**
 * Saves user-edited voiceover, visual_prompt, and/or duration_s to the
 * clips row. The stored values are what regen_clip_from_text reads when
 * the user clicks Re-render — so this is the single point of write for
 * "the exact text Seedance will see on the next render."
 *
 * Any field can be omitted to leave it unchanged. If multiple are
 * provided, all are written in one update.
 *
 * Empty/whitespace-only voiceover or visual_prompt is treated as a
 * skip, NOT an error. Background: Phase 2's `useOptimisticSave`
 * autosaves on every keystroke. When an operator selects-all-deletes
 * to retype, the cleared intermediate state would otherwise toast an
 * error on every keystroke between clear and retype. The downstream
 * pipeline is still protected: clips.voiceover is NOT NULL at the DB
 * level (so we can't write empty anyway), and Modal's
 * `_overlay_edits_onto_plan` / `clips_only_job` overlay loops fall
 * back to the plan-generated voiceover when an operator edit is empty
 * (see src/operator_overlays.py + modal_app.py:5886). The worst case
 * if an operator commits an empty edit and triggers a render is that
 * Seedance speaks the AI-generated voiceover instead of a silent clip.
 *
 * Phase 0.3 (2026-06-03) collapsed `savePlanClip` into this action.
 * `duration_s` was added here to absorb the Phase 2 duration writer.
 */
export async function updateClipText(opts: {
  clipId: string;
  voiceover?: string;
  visualPrompt?: string;
  durationS?: number;
}): Promise<{ ok: true } | { error: string }> {
  const { clipId, voiceover, visualPrompt, durationS } = opts;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const update: Record<string, string | number> = {};
  if (voiceover !== undefined) {
    // Empty/whitespace = skip silently. See module docstring for why
    // we DON'T return an error here. The NOT NULL DB constraint + the
    // overlay-fallback in Modal's regen paths give us defence in depth.
    if (voiceover.trim().length > 0) {
      if (voiceover.length > MAX_VOICEOVER_CHARS) {
        return { error: `Voiceover too long (max ${MAX_VOICEOVER_CHARS} chars)` };
      }
      update.voiceover = voiceover;
    }
  }
  if (visualPrompt !== undefined) {
    // Same skip-on-empty semantics as voiceover above.
    if (visualPrompt.trim().length > 0) {
      if (visualPrompt.length > MAX_VISUAL_PROMPT_CHARS) {
        return { error: `Scene direction too long (max ${MAX_VISUAL_PROMPT_CHARS} chars)` };
      }
      update.visual_prompt = visualPrompt;
    }
  }
  if (durationS !== undefined) {
    // duration_s is a hard numeric — out-of-range gets rejected
    // explicitly (no overlay fallback for this field). DB column is
    // a numeric/int, so a NaN slip-through would be a 400 from
    // Supabase anyway — catch it here for a clearer error.
    if (!Number.isFinite(durationS) || durationS < DURATION_MIN_S || durationS > DURATION_MAX_S) {
      return { error: `Duration must be ${DURATION_MIN_S}–${DURATION_MAX_S} seconds.` };
    }
    update.duration_s = durationS;
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
