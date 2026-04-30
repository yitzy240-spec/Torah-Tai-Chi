'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const CANCELLABLE_STATUSES = [
  'queued',
  'loading_parsha',
  'generating_plan',
  'uploading_refs',
  'generating_clips',
  'stitching',
];

/**
 * Mark an in-flight job as cancelled. Modal's worker will keep running
 * to completion (Modal can't kill a function from outside cleanly), but
 * the dashboard treats the job as done — autopilot won't fire and the
 * UI flips to a Cancelled state immediately.
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

  const { error: updErr } = await supabase
    .from('jobs')
    .update({
      status: 'cancelled',
      status_message: 'Cancelled by user',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);
  if (updErr) return { error: `Could not cancel job: ${updErr.message}` };

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
