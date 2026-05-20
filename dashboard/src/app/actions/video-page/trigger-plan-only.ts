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
 *
 * Returns a typed result instead of throwing so the client can surface
 * actionable error messages rather than a generic 500.
 */
export async function triggerPlanOnly(
  parshaId: string,
  scriptId: string,
): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  // Guard: both IDs must be non-empty strings before touching the DB.
  if (!parshaId || !scriptId) {
    return { ok: false, error: `Missing required IDs (parshaId=${parshaId}, scriptId=${scriptId})` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const workerUrl = process.env.MODAL_WORKER_URL;
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!workerUrl) return { ok: false, error: 'MODAL_WORKER_URL not configured on this environment' };
  if (!triggerSecret) return { ok: false, error: 'PIPELINE_TRIGGER_SECRET not configured on this environment' };

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
  if (jobErr || !job) {
    return { ok: false, error: `DB insert failed: ${jobErr?.message ?? 'unknown error'}` };
  }

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
        parsha_id: parshaId,
        script_id: scriptId,
      }),
      // Same 15-second ceiling as trigger-generation.ts (covers Modal cold-start).
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      // Mark the job failed so it doesn't stay stuck as 'queued'.
      await supabase
        .from('jobs')
        .update({ status: 'failed', error_message: `Modal HTTP ${res.status}` })
        .eq('id', job.id);
      return { ok: false, error: `Modal trigger returned HTTP ${res.status}` };
    }
  } catch (e) {
    const err = e as Error;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      // Timeout expected during Modal cold-start (~7s). Job is queued — continue.
    } else {
      await supabase
        .from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', job.id);
      return { ok: false, error: `Modal fetch failed: ${err.message}` };
    }
  }

  return { ok: true, jobId: job.id };
}
