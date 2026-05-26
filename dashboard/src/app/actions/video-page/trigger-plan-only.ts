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

  // Idempotency: if a plan-only job for this script is already queued
  // or running, return its id instead of inserting a duplicate. Without
  // this, an URL like ?start_plan=1&script_id=X that gets retried (refresh,
  // network flake on the redirect) creates duplicate Modal jobs.
  const { data: inFlight } = await supabase
    .from('jobs')
    .select('id, status')
    .eq('parsha_id', parshaId)
    .eq('script_id', scriptId)
    .eq('kind', 'plan-only')
    .in('status', ['queued', 'loading_parsha', 'generating_plan', 'verifying'])
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inFlight) {
    return { ok: true, jobId: inFlight.id as string };
  }

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
