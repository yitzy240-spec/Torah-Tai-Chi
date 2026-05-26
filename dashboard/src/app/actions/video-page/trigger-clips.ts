'use server';
import { createClient } from '@/lib/supabase/server';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';

/**
 * Insert a clips-only job and fire the Modal clips-only endpoint.
 *
 * Pass clipIndexes=null to generate all clips; pass a non-empty array to
 * generate only the specified clip indexes (0-based).
 *
 * tier (resolution + modelTier) controls Seedance render quality. When
 * omitted (or null fields), the job row's resolution/model_tier stay
 * NULL and Modal's clips_only_job falls back via this_job → parent_job
 * → "720p"/"standard" (modal_app.py line 5674-5678).
 *
 * Auth-checks via the user cookie (same pattern as triggerGeneration).
 */
export async function triggerClips(
  clipPlanId: string,
  clipIndexes: number[] | null, // null = all clips
  tier?: { resolution: Resolution; modelTier: ModelTier },
): Promise<{ jobId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Look up the parent plan-only job to wire the regen link AND grab
  // its parsha_id. The clips-only row needs parsha_id denormalized so
  // any parsha-filtered query (jobs list, dashboard "in flight" badges,
  // diagnostic SQL) can find it without walking the regen_of_job_id
  // chain. Without this, jobs.parsha_id stays NULL on the row and
  // queries like "SELECT * FROM jobs WHERE parsha_id = …" miss it.
  //
  // Two separate queries instead of a PostgREST embed — relies only on
  // standard SELECTs by primary key, avoiding the schema-cache FK-
  // resolution failure that hit the earlier "jobs!inner(parsha_id)"
  // embed in prod (Server-Components-render error 2026-05-26).
  const { data: plan, error: planErr } = await supabase
    .from('clip_plans')
    .select('job_id')
    .eq('id', clipPlanId)
    .maybeSingle();
  if (planErr) throw new Error(`clip_plan lookup failed: ${planErr.message}`);
  if (!plan?.job_id) throw new Error('clip_plan not found');
  const parentJobId = plan.job_id as string;

  const { data: parentJob } = await supabase
    .from('jobs')
    .select('parsha_id')
    .eq('id', parentJobId)
    .maybeSingle();
  const parentParshaId = (parentJob?.parsha_id as string | null | undefined) ?? null;

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      kind: 'clips-only',
      status: 'queued',
      regen_of_job_id: parentJobId,
      parsha_id: parentParshaId,
      triggered_by: user.id,
      resolution: tier?.resolution ?? null,
      model_tier: tier?.modelTier ?? null,
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
