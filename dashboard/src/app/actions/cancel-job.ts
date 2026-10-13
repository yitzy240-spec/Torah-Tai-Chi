'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const CANCELLABLE_STATUSES = [
  'queued',
  'loading_parsha',
  'generating_plan',
  'uploading_refs',
  'generating_clips',
  'verifying', // job_status enum; Modal's verify loop sets it mid-render
  'stitching',
];

/**
 * Mark an in-flight job as cancelled. Modal can't kill a function from
 * outside, but every worker status write is guarded (src/db_rows.py), so
 * 'cancelled' is never overwritten: the worker stops at its next stage
 * transition (before new renders, or before stitching once the paid
 * clips in flight are saved). Autopilot won't fire and the UI flips to a
 * Cancelled state immediately.
 *
 * Any costs already incurred up to the cancellation point are sunk.
 */
export async function cancelJob(
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
  if (readErr || !job) return { error: readErr?.message ?? 'Job not found' };

  if (!CANCELLABLE_STATUSES.includes(job.status)) {
    return {
      error:
        `Can't cancel a job that's already ${job.status}.`,
    };
  }

  // Guarded in the WHERE clause: if the job finished between the read
  // above and this write, its final status wins.
  const { data: cancelled, error: updErr } = await supabase
    .from('jobs')
    .update({
      status: 'cancelled',
      status_message: 'Cancelled by user',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', CANCELLABLE_STATUSES)
    .select('id');
  if (updErr) return { error: `Could not cancel job: ${updErr.message}` };
  if (!cancelled?.length) {
    revalidatePath(`/jobs/${jobId}`);
    return { error: 'This job just finished, so there was nothing to cancel.' };
  }

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
