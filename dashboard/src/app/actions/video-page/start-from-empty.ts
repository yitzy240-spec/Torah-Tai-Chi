'use server';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Entry point for the "Start scripting" button on the empty state.
 *
 * For now this triggers the existing full parsha pipeline (script + plan +
 * clips + stitch in one shot). The user lands on Phase 1 while the pipeline
 * runs; once the auto-generated script is ready they can review it.
 *
 * TODO(milestone-1b): When the plan-only Modal kind ships, replace the
 * full-pipeline trigger here with triggerPlanOnly() so the pipeline stops
 * after plan generation and the user gets the Phase 1 → Phase 2 checkpoint.
 *
 * Falls back gracefully: if no A-tight script exists yet (scripts are written
 * by the pipeline during its run), Phase 1 shows a "generating…" message.
 */
export async function startFromEmpty(
  parshaId: string,
  parshaSlug: string,
): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  // Check whether an A-tight script already exists for this parsha.
  // If yes, we can kick off a plan-only job (for when M1b ships).
  // For now we always use the full parsha pipeline.
  const { data: scripts } = await supabase
    .from('scripts')
    .select('id, option')
    .eq('parsha_id', parshaId)
    .in('option', ['A-tight', 'A']);

  const scriptId = scripts?.[0]?.id ?? null;

  if (!scriptId) {
    // No script yet — run the full pipeline; it will auto-generate the script.
    // We don't have a script_id to pass, so we find/create the default one
    // by letting triggerGeneration do it. But triggerGeneration requires a
    // script_id. Since scripts don't exist, we can't use it directly.
    //
    // Workaround: insert a minimal placeholder script row so the pipeline
    // has a script_id to attach to. The pipeline will overwrite the text
    // with its generated version (scripts table's draft_text column).
    //
    // TODO(milestone-1b): Remove this workaround once plan-only is live.
    const { data: placeholder, error: scriptErr } = await supabase
      .from('scripts')
      .insert({ parsha_id: parshaId, option: 'A-tight', draft_text: '' })
      .select('id')
      .single();
    if (scriptErr || !placeholder)
      return { ok: false, error: scriptErr?.message ?? 'Could not create placeholder script' };

    // Insert the job
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .insert({
        parsha_id: parshaId,
        script_id: placeholder.id,
        kind: 'parsha',
        status: 'queued',
        triggered_by: user.id,
      })
      .select('id')
      .single();
    if (jobErr || !job) return { ok: false, error: jobErr?.message ?? 'Could not queue job' };

    const workerUrl = process.env.MODAL_WORKER_URL;
    const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
    if (!workerUrl) return { ok: false, error: 'MODAL_WORKER_URL not set' };
    if (!triggerSecret) return { ok: false, error: 'PIPELINE_TRIGGER_SECRET not set' };

    try {
      await fetch(workerUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pipeline-secret': triggerSecret,
        },
        body: JSON.stringify({ job_id: job.id }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
        await supabase
          .from('jobs')
          .update({ status: 'failed', error_message: String(e) })
          .eq('id', job.id);
        return { ok: false, error: String(e) };
      }
    }

    revalidatePath('/', 'layout');
    revalidatePath(`/videos/${parshaSlug}`, 'layout');
    return { ok: true, jobId: job.id };
  }

  // Script exists — just queue a parsha job pointing at the existing script.
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      parsha_id: parshaId,
      script_id: scriptId,
      kind: 'parsha',
      status: 'queued',
      triggered_by: user.id,
    })
    .select('id')
    .single();
  if (jobErr || !job) return { ok: false, error: jobErr?.message ?? 'Could not queue job' };

  const workerUrl = process.env.MODAL_WORKER_URL;
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!workerUrl) return { ok: false, error: 'MODAL_WORKER_URL not set' };
  if (!triggerSecret) return { ok: false, error: 'PIPELINE_TRIGGER_SECRET not set' };

  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
      body: JSON.stringify({ job_id: job.id }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase
        .from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', job.id);
      return { ok: false, error: String(e) };
    }
  }

  revalidatePath('/', 'layout');
  revalidatePath(`/videos/${parshaSlug}`, 'layout');
  return { ok: true, jobId: job.id };
}
