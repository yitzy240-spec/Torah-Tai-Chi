'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';

/**
 * Entry point for the "Start scripting" button on the empty state.
 *
 * NON-NEGOTIABLE PRINCIPLE: this action MUST NOT trigger any Modal pipeline.
 * It does nothing more than ensure there is a script row Yonah can edit, then
 * returns so the page can route him to Phase 1.
 *
 * Why: a previous implementation here queued a full kind='parsha' Modal job
 * (script + plan + clips + stitch) and burned real Kie/Seedance credits
 * before the operator even saw Phase 1. That cost Yonah money for work he
 * never asked for. Do NOT re-introduce that pattern. Any AI generation
 * (script variants, plan, clips, etc.) must be triggered by an explicit
 * separate user action with its own button + confirm — never as a side-effect
 * of "Start scripting".
 *
 * Behavior:
 *   1. Auth check.
 *   2. If a placeholder/A-tight script row already exists for the parsha,
 *      return its id.
 *   3. Otherwise insert a single blank placeholder script (option='A-tight',
 *      empty draft_text) so Phase 1 has something to bind to.
 *   4. Revalidate the page and return the script id.
 *
 * No jobs row is inserted. No fetch to Modal. No external API hit.
 */
export async function startFromEmpty(
  parshaId: string,
  parshaSlug: string,
): Promise<{ ok: true; scriptId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  // Check whether a script already exists for this parsha.
  const { data: existing } = await supabase
    .from('scripts')
    .select('id, option, draft_text')
    .eq('parsha_id', parshaId)
    .order('option', { ascending: true });

  // Prefer A-tight, fall back to A, then anything.
  const preferred =
    existing?.find((s) => s.option === 'A-tight') ??
    existing?.find((s) => s.option === 'A') ??
    existing?.[0] ??
    null;

  if (preferred) {
    return { ok: true, scriptId: preferred.id as string };
  }

  // No script exists — create a blank placeholder via service-role client.
  // RLS on `scripts` only allows authed reads, not authed writes — same
  // pattern as add-move-to-script.ts / saveScriptDraft. Without this the
  // insert silently matches zero rows and the page stays stuck on empty.
  // The Phase 1 editor will bind to this row; whatever Yonah types becomes
  // the draft_text. No Modal call. No cost. No surprise pipeline runs.
  const svc = createServiceClient();
  const { data: placeholder, error: insertErr } = await svc
    .from('scripts')
    .insert({
      parsha_id: parshaId,
      option: 'A-tight',
      draft_text: '',
    })
    .select('id')
    .single();

  if (insertErr || !placeholder) {
    return { ok: false, error: insertErr?.message ?? 'Could not create placeholder script' };
  }

  revalidatePath('/', 'layout');
  revalidatePath(`/videos/${parshaSlug}`, 'layout');

  return { ok: true, scriptId: placeholder.id as string };
}
