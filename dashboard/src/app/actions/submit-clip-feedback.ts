'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Per-clip feedback path. Always single-clip surgery — no whole-video
 * scope decisions, no LLM diagnose step. The clip the user typed
 * feedback on is the clip we regenerate, period.
 *
 * Falls through to the legacy submit-feedback.ts path ONLY when the
 * parent isn't checkpointed (no storage_path on parent clips). New
 * generations are always checkpointed, so the fallback is for
 * legacy videos predating the checkpoint work.
 */
export async function submitClipFeedback(opts: {
  videoId: string;
  clipId: string;
  text: string;
}): Promise<{ ok: true; jobId: string } | { error: string }> {
  const text = (opts.text ?? '').trim();
  if (text.length === 0) {
    return { error: 'Please describe what felt off before submitting.' };
  }
  const { videoId, clipId } = opts;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: videoRow } = await supabase
    .from('videos').select('id, job_id').eq('id', videoId).single();
  if (!videoRow) return { error: 'Video not found' };
  const parentJobId = videoRow.job_id as string;

  const { data: parentJobRaw } = await supabase
    .from('jobs')
    .select(
      'id, parsha_id, script_id, motion_ref_slug, director_notes, ' +
      'model_tier, resolution, partner_parsha_id, kind, topic',
    )
    .eq('id', parentJobId).single();
  if (!parentJobRaw) return { error: 'Parent job not found' };
  const parentJob = parentJobRaw as unknown as {
    id: string; parsha_id: string | null; script_id: string | null;
    motion_ref_slug: string | null; director_notes: string | null;
    model_tier: string | null; resolution: string | null;
    partner_parsha_id: string | null; kind: string | null;
    topic: string | null;
  };

  const { data: clipRow } = await supabase
    .from('clips')
    .select('voiceover, index, storage_path')
    .eq('id', clipId).maybeSingle();
  if (!clipRow || clipRow.index === null) {
    return { error: 'Clip not found' };
  }
  const voiceover = (clipRow.voiceover ?? null) as string | null;
  const targetClipIndex = clipRow.index as number;
  const targetClipHasCheckpoint = !!clipRow.storage_path;

  // Single-clip surgery requires: parent has clip_plan + ALL parent
  // clips checkpointed. Strictly we only need the target clip's
  // siblings checkpointed for re-stitch, but enforcing all-or-none
  // matches the regen_agent precondition and avoids edge cases.
  const { data: parentPlanRow } = await supabase
    .from('clip_plans')
    .select('plan_json')
    .eq('job_id', parentJobId)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  const hasPlan = !!parentPlanRow?.plan_json;
  const { count: missingCount } = await supabase
    .from('clips')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', parentJobId)
    .is('storage_path', null);
  const allCheckpointed = (missingCount ?? 1) === 0;
  const surgeryEligible = (
    hasPlan && allCheckpointed && targetClipHasCheckpoint
  );

  if (!surgeryEligible) {
    // Legacy fallback. Defer to the old whole-video flow which
    // handles uncheckpointed parents via run_pipeline.
    const { submitFeedback } = await import('./submit-feedback');
    return submitFeedback({ videoId, clipId, text });
  }

  // Insert feedback row.
  const { data: feedbackRow } = await supabase
    .from('feedback').insert({
      video_id: videoId, clip_id: clipId, text,
      status: 'submitted', created_by: user.id,
    }).select('id').single();
  if (!feedbackRow) return { error: 'Could not save feedback' };

  // Build merged director_notes. Same FEEDBACK delimiter as
  // submit-feedback.ts — regen_single_clip uses _extract_feedback_section
  // which keys on this exact prefix.
  const original = (parentJob.director_notes ?? '').toString().trim();
  const feedbackBlock = voiceover
    ? `Feedback about this section: "${voiceover.trim()}"\n${text}`
    : text;
  const feedbackSection =
    `\n\nFEEDBACK ON PREVIOUS VERSION (apply this and only this):\n` +
    feedbackBlock;
  const merged = (original + feedbackSection).trim();

  const { data: regenJob } = await supabase
    .from('jobs').insert({
      parsha_id: parentJob.parsha_id,
      script_id: parentJob.script_id,
      partner_parsha_id: parentJob.partner_parsha_id ?? null,
      kind: parentJob.kind ?? 'parsha',
      topic: parentJob.topic ?? null,
      motion_ref_slug: parentJob.motion_ref_slug ?? null,
      resolution: parentJob.resolution ?? '720p',
      model_tier: parentJob.model_tier ?? 'standard',
      director_notes: merged,
      regen_of_job_id: parentJobId,
      feedback_clip_index: targetClipIndex,
      status: 'queued',
      triggered_by: user.id,
    }).select('id').single();
  if (!regenJob) return { error: 'Could not queue regen' };

  await supabase.from('feedback')
    .update({ applied_to_job_id: regenJob.id, status: 'processing' })
    .eq('id', feedbackRow.id);

  // Dispatch to the new Modal endpoint.
  const baseTriggerUrl = process.env.MODAL_WORKER_URL;
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!baseTriggerUrl || !triggerSecret) {
    await supabase.from('jobs').update({
      status: 'failed',
      error_message: 'MODAL_WORKER_URL or PIPELINE_TRIGGER_SECRET not set',
    }).eq('id', regenJob.id);
    return { error: 'Modal config missing' };
  }
  const workerUrl = baseTriggerUrl.replace(
    'pipeline-trigger', 'pipeline-regen-single-clip-endpoint',
  );
  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
      body: JSON.stringify({ job_id: regenJob.id }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if ((e as Error).name !== 'TimeoutError'
        && (e as Error).name !== 'AbortError') {
      await supabase.from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', regenJob.id);
      return { error: String(e) };
    }
  }

  if (parentJob.parsha_id) {
    const { data: parshaRow } = await supabase
      .from('parshiot')
      .select('slug')
      .eq('id', parentJob.parsha_id)
      .maybeSingle();
    const slug = (parshaRow?.slug as string | undefined) ?? null;
    if (slug) revalidatePath(`/videos/${slug}/edit`);
  }
  return { ok: true, jobId: regenJob.id };
}
