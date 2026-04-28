'use server';
import { createClient } from '@/lib/supabase/server';
import { estimateSeedanceCost, type Resolution, type ModelTier } from '@/lib/seedance-pricing';

const MONTHLY_BUDGET_USD = 80;
const TYPICAL_DURATION_S = 60; // conservative ballpark before Claude writes the real plan
const IN_PROGRESS_STATUSES = [
  'queued', 'loading_parsha', 'generating_plan', 'uploading_refs',
  'generating_clips', 'stitching',
];

export async function triggerGeneration(
  {
    parshaId,
    scriptId,
    partnerParshaId,
    resolution = '720p',
    modelTier = 'standard',
  }: {
    parshaId: string;
    scriptId: string;
    partnerParshaId?: string;
    resolution?: Resolution;
    modelTier?: ModelTier;
  },
): Promise<{ jobId?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Idempotency — block if an active job already exists for this parsha+script.
  const { data: existing } = await supabase
    .from('jobs')
    .select('id')
    .eq('parsha_id', parshaId)
    .eq('script_id', scriptId)
    .in('status', IN_PROGRESS_STATUSES)
    .limit(1);
  if (existing && existing.length > 0) {
    return { error: 'A video is already being generated for this parsha and script. Wait for it to finish.' };
  }

  // Read the script's optional motion reference so we can copy it onto
  // the job — Modal reads jobs.motion_ref_slug as the single source of
  // truth regardless of parsha vs topic origin.
  const { data: scriptRow } = await supabase
    .from('scripts')
    .select('motion_ref_slug')
    .eq('id', scriptId)
    .maybeSingle();
  const motionRefSlug = (scriptRow?.motion_ref_slug ?? null) as string | null;

  // Monthly cost cap — block if adding this run would blow the budget.
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const { data: costRows } = await supabase
    .from('cost_events')
    .select('cost_usd')
    .gte('created_at', startOfMonth.toISOString());
  const monthlySpend = (costRows ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
  const estimated = estimateSeedanceCost(TYPICAL_DURATION_S, resolution, modelTier) ?? 15;
  if (monthlySpend + estimated > MONTHLY_BUDGET_USD) {
    return {
      error: `Monthly budget of $${MONTHLY_BUDGET_USD} would be exceeded: $${monthlySpend.toFixed(2)} already spent + $${estimated.toFixed(2)} estimated for this run. Wait for next month or raise MONTHLY_BUDGET_USD in trigger-generation.ts.`,
    };
  }

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      parsha_id: parshaId,
      script_id: scriptId,
      partner_parsha_id: partnerParshaId ?? null,
      status: 'queued',
      triggered_by: user.id,
      resolution,
      model_tier: modelTier,
      motion_ref_slug: motionRefSlug,
    })
    .select('id').single();

  if (error || !job) return { error: error?.message ?? 'Insert failed' };

  // Fire-and-forget the Modal worker. The worker posts status back to Supabase.
  const workerUrl = process.env.MODAL_WORKER_URL;
  if (!workerUrl) {
    return { error: 'MODAL_WORKER_URL not set' };
  }
  // Shared secret — Modal trigger() rejects requests without this header
  // to prevent unauthenticated callers from spawning paid Seedance runs.
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!triggerSecret) {
    return { error: 'PIPELINE_TRIGGER_SECRET not set' };
  }
  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
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
