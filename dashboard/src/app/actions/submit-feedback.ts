'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Cut 1 of the feedback flow. Yonah can leave general feedback on a video
 * or per-clip feedback tied to a specific clip; either way we kick off a
 * full pipeline regen with the feedback merged into director_notes context.
 *
 * Per-clip surgery (regen only the affected clip's TTS/Seedance) is Cut 2.
 *
 * Mirrors trigger-generation.ts dispatch shape (header secret + 15s
 * timeout). On dispatch failure we revert the regen job to 'failed' so the
 * UI can show retry.
 */
export async function submitFeedback(opts: {
  videoId: string;
  clipId: string | null;
  text: string;
}): Promise<{ ok: true; jobId: string } | { error: string }> {
  const { videoId, clipId } = opts;
  const text = (opts.text ?? '').trim();
  if (text.length === 0) {
    return { error: 'Please describe what felt off before submitting.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Resolve video → parent job. We need the original parameters
  // (parsha_id, script_id, motion_ref_slug, model_tier, resolution,
  // partner_parsha_id, director_notes) to start the regen with the same
  // shape as the original run.
  const { data: videoRow, error: videoErr } = await supabase
    .from('videos')
    .select('id, job_id')
    .eq('id', videoId)
    .single();
  if (videoErr || !videoRow) {
    return { error: videoErr?.message ?? 'Video not found' };
  }
  const parentJobId = videoRow.job_id as string;

  const { data: parentJobRaw, error: jobErr } = await supabase
    .from('jobs')
    .select(
      'id, parsha_id, script_id, motion_ref_slug, director_notes, ' +
      'model_tier, resolution, partner_parsha_id, kind, topic',
    )
    .eq('id', parentJobId)
    .single();
  if (jobErr || !parentJobRaw) {
    return { error: jobErr?.message ?? 'Parent job not found' };
  }
  // The supabase types choke on long select strings and infer the response
  // as GenericStringError; cast to a plain shape so we can read the fields
  // we know exist on jobs.
  const parentJob = parentJobRaw as unknown as {
    id: string;
    parsha_id: string | null;
    script_id: string | null;
    motion_ref_slug: string | null;
    director_notes: string | null;
    model_tier: string | null;
    resolution: string | null;
    partner_parsha_id: string | null;
    kind: string | null;
    topic: string | null;
  };

  // Optional: if the feedback is per-clip, pull the clip's voiceover so we
  // can quote it in director_notes. Claude's prompt then has the exact
  // phrase that triggered the complaint without forcing Yonah to retype.
  let voiceover: string | null = null;
  if (clipId) {
    const { data: clipRow } = await supabase
      .from('clips')
      .select('voiceover')
      .eq('id', clipId)
      .maybeSingle();
    voiceover = (clipRow?.voiceover ?? null) as string | null;
  }

  // Insert the feedback row first so we can FK applied_to_job_id later.
  const { data: feedbackRow, error: fbErr } = await supabase
    .from('feedback')
    .insert({
      video_id: videoId,
      clip_id: clipId,
      text,
      status: 'submitted',
      created_by: user.id,
    })
    .select('id')
    .single();
  if (fbErr || !feedbackRow) {
    return { error: fbErr?.message ?? 'Could not save feedback' };
  }

  // Build merged director_notes: original notes + a "Feedback from previous
  // version" block. For per-clip feedback, prefix the quoted voiceover so
  // Claude has unambiguous anchoring.
  const original = (parentJob.director_notes ?? '').toString().trim();
  const feedbackBlock = voiceover
    ? `Feedback about this section: "${voiceover.trim()}"\n${text}`
    : text;
  const merged = (original
    ? `${original}\n\nFeedback from previous version:\n${feedbackBlock}`
    : `Feedback from previous version:\n${feedbackBlock}`
  ).trim();

  // Insert the new (regen) job with all the original parameters and the
  // version-chain pointer.
  const { data: regenJob, error: regenErr } = await supabase
    .from('jobs')
    .insert({
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
      status: 'queued',
      triggered_by: user.id,
    })
    .select('id')
    .single();
  if (regenErr || !regenJob) {
    // Best-effort rollback of the feedback row's status so it doesn't sit
    // in 'submitted' forever pointing at nothing.
    await supabase
      .from('feedback')
      .update({ status: 'rejected' })
      .eq('id', feedbackRow.id);
    return { error: regenErr?.message ?? 'Could not queue regen' };
  }

  // Link feedback → regen job, flip to processing.
  await supabase
    .from('feedback')
    .update({ applied_to_job_id: regenJob.id, status: 'processing' })
    .eq('id', feedbackRow.id);

  // Fire-and-forget Modal worker. Same shape as trigger-generation.ts.
  const workerUrl = process.env.MODAL_WORKER_URL;
  if (!workerUrl) {
    await supabase.from('jobs')
      .update({ status: 'failed', error_message: 'MODAL_WORKER_URL not set' })
      .eq('id', regenJob.id);
    return { error: 'MODAL_WORKER_URL not set' };
  }
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!triggerSecret) {
    await supabase.from('jobs')
      .update({ status: 'failed', error_message: 'PIPELINE_TRIGGER_SECRET not set' })
      .eq('id', regenJob.id);
    return { error: 'PIPELINE_TRIGGER_SECRET not set' };
  }
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
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase
        .from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', regenJob.id);
      return { error: String(e) };
    }
  }

  // We don't know the parsha slug here without another round-trip; the
  // /videos route revalidates list views. The detail page revalidation
  // happens via the /videos/[slug] path the caller is on (server action
  // returns to that page; Next will re-run the loader on the redirect
  // target if relevant). We also revalidate the new job's progress page.
  revalidatePath('/videos');
  revalidatePath(`/jobs/${regenJob.id}`);

  return { ok: true, jobId: regenJob.id as string };
}
