'use server';
import { createClient } from '@/lib/supabase/server';

/**
 * Insert a plan-only job row. Does NOT fire Modal — that's a separate
 * action (kickPlanOnly) called from the PlanGeneratingCard after the
 * user navigates to Phase 2.
 *
 * Why split: a fire-and-forget Modal fetch inside this action (via void
 * IIFE) was keeping the Vercel function's response open until the fetch
 * settled, so Phase 1 hung on "Generating clip plan…" until Modal's
 * 60s timeout. Inserting the row is the whole job of this action;
 * dispatching Modal is the next page's job.
 */
export async function triggerPlanOnly(
  parshaId: string,
  scriptId: string,
): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  if (!parshaId || !scriptId) {
    return { ok: false, error: `Missing required IDs (parshaId=${parshaId}, scriptId=${scriptId})` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      parsha_id: parshaId,
      script_id: scriptId,
      kind: 'plan-only',
      status: 'queued',
      triggered_by: user.id,
    })
    .select('id')
    .single();
  if (jobErr || !job) {
    return { ok: false, error: `DB insert failed: ${jobErr?.message ?? 'unknown error'}` };
  }

  return { ok: true, jobId: job.id };
}
