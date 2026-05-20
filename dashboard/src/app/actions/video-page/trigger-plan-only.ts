'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

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

  // Fire-and-forget the Modal dispatch. We don't await here because the
  // operator-facing UX (Phase 1 → Phase 2 nav + spinner) shouldn't wait
  // for Modal's cold-start (~7s) before showing the next screen. If the
  // dispatch fails, the background promise updates the job to 'failed'
  // via service role, and the PlanGeneratingCard's Realtime subscription
  // surfaces the error to the user.
  void (async () => {
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
        // Generous timeout — Modal may cold-start (~7s); we have all
        // the time the operator's Phase 2 spinner gives us.
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        const svc = createServiceClient();
        await svc
          .from('jobs')
          .update({ status: 'failed', error_message: `Modal HTTP ${res.status}` })
          .eq('id', job.id);
      }
    } catch (e) {
      const err = e as Error;
      const svc = createServiceClient();
      await svc
        .from('jobs')
        .update({ status: 'failed', error_message: `Modal fetch failed: ${err.message}` })
        .eq('id', job.id);
    }
  })();

  return { ok: true, jobId: job.id };
}
