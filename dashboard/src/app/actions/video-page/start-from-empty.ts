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

  // `scripts.title` is NOT NULL with no default (0001_slice1_schema.sql).
  // Omitting it is what surfaced as
  //   null value in column "title" of relation "scripts" violates not-null constraint
  // when Yonah clicked "Start scripting" on Ki Teitzei — the first parsha
  // reached that had no seeded script row, so it was the first click to
  // actually run this insert. Seed the title from the parsha name rather
  // than '' so the website's A-tight title fallback
  // (website/src/lib/parshiot.ts) still reads sensibly if a video ships
  // before the title is edited.
  const { data: parsha } = await svc
    .from('parshiot')
    .select('name')
    .eq('id', parshaId)
    .maybeSingle();
  const placeholderTitle = (parsha?.name as string | undefined)?.trim() || 'Untitled';

  const { data: placeholder, error: insertErr } = await svc
    .from('scripts')
    .insert({
      parsha_id: parshaId,
      option: 'A-tight',
      title: placeholderTitle,
      draft_text: '',
    })
    .select('id')
    .single();

  if (insertErr || !placeholder) {
    // A double-click (or two tabs) can race past the existence check above
    // and trip the unique (parsha_id, option) constraint. That's a win, not
    // an error — the row the other call created is exactly what we wanted.
    if (insertErr?.code === '23505') {
      const { data: raced } = await svc
        .from('scripts')
        .select('id')
        .eq('parsha_id', parshaId)
        .eq('option', 'A-tight')
        .maybeSingle();
      if (raced) return { ok: true, scriptId: raced.id as string };
    }
    return { ok: false, error: insertErr?.message ?? 'Could not create placeholder script' };
  }

  // Narrow revalidation. Layout-scope was busting buffer-* cache tags
  // — see save-platform-caption.ts writeup.
  revalidatePath(`/videos/${parshaSlug}`);

  return { ok: true, scriptId: placeholder.id as string };
}
