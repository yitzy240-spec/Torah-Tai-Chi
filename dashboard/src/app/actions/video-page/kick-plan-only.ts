'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Dispatch the Modal plan-only worker for an already-queued job.
 *
 * Called by PlanGeneratingCard once after the user has navigated to
 * Phase 2 — the spinner is already showing, so we can comfortably await
 * Modal's cold-start (~7s) without the operator perceiving a hang.
 *
 * Idempotency: the caller is responsible for only invoking this once
 * per job (the card guards with a ref). The Modal worker also accepts
 * the same job_id idempotently (resume-in-place).
 *
 * On error the job is marked 'failed' so the card's Realtime
 * subscription surfaces it to the operator.
 */
export async function kickPlanOnly(
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const { data: job } = await supabase
    .from('jobs')
    .select('id, parsha_id, script_id, kind, status')
    .eq('id', jobId)
    .single();
  if (!job) return { ok: false, error: 'Job not found' };
  if (job.kind !== 'plan-only') return { ok: false, error: `Job kind is ${job.kind}, not plan-only` };

  const workerUrl = process.env.MODAL_WORKER_URL;
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!workerUrl) return { ok: false, error: 'MODAL_WORKER_URL not configured' };
  if (!triggerSecret) return { ok: false, error: 'PIPELINE_TRIGGER_SECRET not configured' };

  try {
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
      body: JSON.stringify({
        kind: 'plan-only',
        job_id: job.id,
        parsha_id: job.parsha_id,
        script_id: job.script_id,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const svc = createServiceClient();
      await svc
        .from('jobs')
        .update({ status: 'failed', error_message: `Modal HTTP ${res.status}` })
        .eq('id', job.id);
      return { ok: false, error: `Modal trigger returned HTTP ${res.status}` };
    }
  } catch (e) {
    const err = e as Error;
    // Cold-start timeout is fine — Modal accepts the job and runs async.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { ok: true };
    }
    const svc = createServiceClient();
    await svc
      .from('jobs')
      .update({ status: 'failed', error_message: `Modal fetch failed: ${err.message}` })
      .eq('id', job.id);
    return { ok: false, error: `Modal fetch failed: ${err.message}` };
  }

  return { ok: true };
}
