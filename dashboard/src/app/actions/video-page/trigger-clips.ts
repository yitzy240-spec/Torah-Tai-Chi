'use server';
import { createClient } from '@/lib/supabase/server';

/**
 * Insert a clips-only job and fire the Modal clips-only endpoint.
 *
 * Pass clipIndexes=null to generate all clips; pass a non-empty array to
 * generate only the specified clip indexes (0-based).
 *
 * NOTE: The Modal-side handler for kind='clips-only' is not yet implemented
 * (Milestone 1b deferred). This action will return an error at runtime until
 * that work ships. The Modal endpoint is expected to live at MODAL_WORKER_URL,
 * and the worker must branch on kind='clips-only' to skip plan generation and
 * start directly at clip rendering (optionally filtering to the given indexes).
 *
 * Auth-checks via the user cookie (same pattern as triggerGeneration).
 */
export async function triggerClips(
  clipPlanId: string,
  clipIndexes: number[] | null, // null = all clips
): Promise<{ jobId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Look up the parent plan-only job to wire the regen link.
  const { data: plan } = await supabase
    .from('clip_plans')
    .select('job_id')
    .eq('id', clipPlanId)
    .single();
  if (!plan) throw new Error('clip_plan not found');

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      kind: 'clips-only',
      status: 'queued',
      regen_of_job_id: plan.job_id,
      triggered_by: user.id,
    })
    .select('id')
    .single();
  if (jobErr || !job) throw new Error(jobErr?.message ?? 'Could not queue clips-only job');

  const workerUrl = process.env.MODAL_WORKER_URL;
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!workerUrl) throw new Error('MODAL_WORKER_URL not set');
  if (!triggerSecret) throw new Error('PIPELINE_TRIGGER_SECRET not set');

  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
      body: JSON.stringify({
        kind: 'clips-only',
        job_id: job.id,
        clip_plan_id: clipPlanId,
        clip_indexes: clipIndexes,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase
        .from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', job.id);
      throw e;
    }
  }

  return { jobId: job.id };
}
