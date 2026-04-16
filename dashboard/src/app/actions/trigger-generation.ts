'use server';
import { createClient } from '@/lib/supabase/server';

export async function triggerGeneration(
  { parshaId, scriptId }: { parshaId: string; scriptId: string },
): Promise<{ jobId?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      parsha_id: parshaId,
      script_id: scriptId,
      status: 'queued',
      triggered_by: user.id,
    })
    .select('id').single();

  if (error || !job) return { error: error?.message ?? 'Insert failed' };

  // Fire-and-forget the Modal worker. The worker posts status back to Supabase.
  const workerUrl = process.env.MODAL_WORKER_URL;
  if (!workerUrl) {
    return { error: 'MODAL_WORKER_URL not set' };
  }
  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: job.id }),
      // Don't await the response body; the worker takes 15-30 min.
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    // It's OK if the fetch aborts — Modal accepts the job and continues.
    // Only fail if we can't even dispatch.
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase.from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', job.id);
      return { error: String(e) };
    }
  }

  return { jobId: job.id };
}
