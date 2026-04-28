'use server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { estimateSeedanceCost, type Resolution, type ModelTier } from '@/lib/seedance-pricing';

const MONTHLY_BUDGET_USD = 80;
const TYPICAL_DURATION_S = 60; // conservative ballpark before Claude writes the real plan
const DIRECTOR_NOTES_MAX_CHARS = 1000;
const IN_PROGRESS_STATUSES = [
  'queued', 'loading_parsha', 'generating_plan', 'uploading_refs',
  'generating_clips', 'stitching',
];

/**
 * directorNotes semantics:
 *  - undefined  → caller has no notes UI; copy whatever's currently on the script onto the job.
 *  - "" or "   " → user explicitly cleared the field; persist as null on the script, snapshot null onto the job.
 *  - non-empty  → trim, validate length, persist on the script, snapshot onto the job.
 */
export async function triggerGeneration(
  {
    parshaId,
    scriptId,
    partnerParshaId,
    resolution = '720p',
    modelTier = 'standard',
    directorNotes,
  }: {
    parshaId: string;
    scriptId: string;
    partnerParshaId?: string;
    resolution?: Resolution;
    modelTier?: ModelTier;
    directorNotes?: string;
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

  // Read the script's optional motion reference + persistent director_notes so
  // we can copy them onto the job — Modal reads jobs.* as the single source of
  // truth regardless of parsha vs topic origin.
  const { data: scriptRow } = await supabase
    .from('scripts')
    .select('motion_ref_slug, director_notes')
    .eq('id', scriptId)
    .maybeSingle();
  const motionRefSlug = (scriptRow?.motion_ref_slug ?? null) as string | null;
  let scriptDirectorNotes = (scriptRow?.director_notes ?? null) as string | null;

  // If the dialog passed directorNotes, normalize and persist back to the script
  // before we snapshot to the job, so the script and job agree.
  if (directorNotes !== undefined) {
    const trimmed = directorNotes.trim();
    if (trimmed.length > DIRECTOR_NOTES_MAX_CHARS) {
      return { error: `Director notes too long (max ${DIRECTOR_NOTES_MAX_CHARS} chars)` };
    }
    const next = trimmed === '' ? null : trimmed;
    if (next !== scriptDirectorNotes) {
      const svc = createServiceClient();
      const { error: updateErr } = await svc
        .from('scripts')
        .update({ director_notes: next })
        .eq('id', scriptId);
      if (updateErr) return { error: `Could not save director notes: ${updateErr.message}` };
    }
    scriptDirectorNotes = next;
  }

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
      director_notes: scriptDirectorNotes,
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
