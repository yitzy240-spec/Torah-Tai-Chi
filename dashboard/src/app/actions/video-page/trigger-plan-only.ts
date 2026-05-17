'use server';
import { createClient } from '@/lib/supabase/server';

/**
 * Insert a plan-only job and fire the Modal plan-only endpoint.
 *
 * NOTE: The Modal-side handler for kind='plan-only' is not yet implemented
 * (Milestone 1b deferred). This action will return an error at runtime until
 * that work ships. The Modal endpoint is expected to live at MODAL_WORKER_URL
 * (same URL convention as the existing pipeline trigger), and the worker must
 * branch on kind='plan-only' to run only Claude plan generation and stop
 * before clip rendering.
 *
 * Auth-checks via the user cookie (same pattern as triggerGeneration).
 */
export async function triggerPlanOnly(
  parshaId: string,
  scriptId: string,
): Promise<{ jobId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Insert the job row first (matches existing Modal trigger pattern in trigger-generation.ts).
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
  if (jobErr || !job) throw new Error(jobErr?.message ?? 'Could not queue plan-only job');

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
        kind: 'plan-only',
        job_id: job.id,
        parsha_id: parshaId,
        script_id: scriptId,
      }),
      // Same 15-second ceiling as trigger-generation.ts (covers Modal cold-start).
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
    // TimeoutError is expected — Modal cold-start can take ~7s. Continue.
  }

  return { jobId: job.id };
}
