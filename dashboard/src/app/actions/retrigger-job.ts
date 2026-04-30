'use server';
import { createClient } from '@/lib/supabase/server';

const RETRIGGERABLE_STATUSES = ['failed', 'cancelled'];

/**
 * Re-trigger an existing failed/cancelled job by reusing its job_id. Modal's
 * idempotency layer accepts the same id and resumes a fresh pipeline run; we
 * reset job-level error state so the progress UI doesn't keep showing the
 * stale failure while the new attempt is in flight.
 *
 * Mirrors the dispatch shape of trigger-generation.ts (header secret + 15s
 * timeout) deliberately — the worker treats these requests identically.
 */
export async function retriggerJob(
  jobId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: job, error: readErr } = await supabase
    .from('jobs')
    .select('id, status')
    .eq('id', jobId)
    .single();

  if (readErr || !job) {
    return { error: readErr?.message ?? 'Job not found' };
  }

  if (!RETRIGGERABLE_STATUSES.includes(job.status)) {
    return {
      error:
        `Can't retry a job that's currently ${job.status}. ` +
        `Wait for it to finish or fail.`,
    };
  }

  // Reset to queued + clear failure state so the live UI flips back to the
  // step indicator immediately. completed_at is also cleared so any "Done"
  // styling from a partial prior render doesn't linger.
  const { error: updErr } = await supabase
    .from('jobs')
    .update({
      status: 'queued',
      status_message: null,
      error_message: null,
      completed_at: null,
    })
    .eq('id', jobId);
  if (updErr) return { error: `Could not reset job: ${updErr.message}` };

  const workerUrl = process.env.MODAL_WORKER_URL;
  if (!workerUrl) return { error: 'MODAL_WORKER_URL not set' };
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!triggerSecret) return { error: 'PIPELINE_TRIGGER_SECRET not set' };

  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
      body: JSON.stringify({ job_id: jobId }),
      // Same 15s ceiling as trigger-generation: covers cold-start + auth
      // round-trip, then we expect Modal to keep running asynchronously.
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      // Couldn't even dispatch — flip back to failed so the user can try again.
      await supabase
        .from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', jobId);
      return { error: String(e) };
    }
  }

  return { ok: true };
}
