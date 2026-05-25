'use server';
import { createClient } from '@/lib/supabase/server';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';

// Mirrors trigger-generation.ts. Kept inline rather than imported so
// this file stays self-contained — if the canonical list ever grows,
// update both. (Both lists are short and rarely change.)
const IN_PROGRESS_STATUSES = [
  'queued', 'loading_parsha', 'generating_plan', 'uploading_refs',
  'generating_clips', 'stitching',
];

/**
 * Triggers a no-AI re-render of one clip. Inserts a regen job pointing
 * at the parent (so Modal's regen_clip_from_text reads the parent's
 * stored voiceover/visual_prompt — both fields the user just saved via
 * update-clip-text.ts), then dispatches the Modal endpoint.
 */
export async function regenClipFromText(opts: {
  videoId: string;
  clipIndex: number;
  /** clip_id the user was viewing/editing when they clicked Re-render.
   *  When passed, the regen parents off THIS clip's owning job, not the
   *  top-player video's job. Required path for users editing a non-
   *  latest chip — without it, edits land on the chip's clip_id but
   *  Modal reads from a different job's clip and renders the wrong
   *  text. Yonah's 2026-05-17 Shavuot V8/V9 bug: edited V8 chip
   *  (job 9b2ae20e), Re-render parented from top-player video
   *  (job 1cc92e02), Modal read 1cc92e02's clip 2 → rendered the
   *  unedited "TOH-rah" text instead of his CRANE edit. */
  clipId?: string;
  /** Optional override — re-render at a different resolution than the
   *  parent job. Useful when bumping a clip from 720p Fast → 1080p
   *  Standard (or going the other way for cheap drafts). When omitted,
   *  falls through to the parent job's resolution. */
  resolution?: Resolution;
  /** Optional override — re-render at a different model tier than the
   *  parent. Same fallthrough semantics as `resolution`. */
  modelTier?: ModelTier;
}): Promise<{ ok: true; jobId: string } | { error: string }> {
  const { videoId, clipIndex, clipId, resolution: resOverride, modelTier: tierOverride } = opts;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Resolve parentJobId from the chip the user clicked Re-render on
  // (clipId → its owning job). Falls back to the displayed video's
  // job when clipId isn't passed (legacy callers / compose context).
  // Modal then reads parent_clips for THIS job, which is the same row
  // updateClipText wrote the user's edits to.
  let parentJobId: string;
  if (clipId) {
    const { data: clipRow } = await supabase
      .from('clips').select('job_id').eq('id', clipId).maybeSingle();
    if (!clipRow) return { error: 'Edited clip not found' };
    parentJobId = clipRow.job_id as string;
  } else {
    const { data: videoRow } = await supabase
      .from('videos').select('id, job_id').eq('id', videoId).single();
    if (!videoRow) return { error: 'Video not found' };
    parentJobId = videoRow.job_id as string;
  }

  const { data: parentJob } = await supabase
    .from('jobs')
    .select('parsha_id, script_id, resolution, model_tier, motion_ref_slug, partner_parsha_id, kind, topic')
    .eq('id', parentJobId).single();
  if (!parentJob) return { error: 'Parent job not found' };

  // Idempotency — block double-clicks. Each in-flight regen costs ~$1.20
  // of Seedance, so two concurrent renders for the same (parent job,
  // clip index) is a real $2.40 mistake. Scoped to that pair so the
  // user can still queue regens for *different* clips of the same video
  // in parallel.
  const { data: existingRegen } = await supabase
    .from('jobs')
    .select('id')
    .eq('regen_of_job_id', parentJobId)
    .eq('feedback_clip_index', clipIndex)
    .in('status', IN_PROGRESS_STATUSES)
    .limit(1);
  if (existingRegen && existingRegen.length > 0) {
    return { error: 'A re-render is already in progress for this clip. Wait for it to finish.' };
  }

  // Insert a regen job pointing at the parent + the clip to regen.
  const { data: regenJob, error } = await supabase
    .from('jobs')
    .insert({
      parsha_id: parentJob.parsha_id,
      script_id: parentJob.script_id,
      partner_parsha_id: parentJob.partner_parsha_id ?? null,
      regen_of_job_id: parentJobId,
      feedback_clip_index: clipIndex,
      kind: parentJob.kind ?? 'parsha',
      topic: parentJob.topic ?? null,
      status: 'queued',
      triggered_by: user.id,
      resolution: resOverride ?? parentJob.resolution,
      model_tier: tierOverride ?? parentJob.model_tier,
      motion_ref_slug: parentJob.motion_ref_slug,
    })
    .select('id').single();
  if (error || !regenJob) return { error: error?.message ?? 'Insert failed' };

  const workerUrl = process.env.MODAL_REGEN_CLIP_FROM_TEXT_URL;
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!workerUrl || !triggerSecret) {
    return { error: 'Pipeline endpoint not configured' };
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
    // It's OK if the fetch aborts — Modal accepts the job and continues.
    // Only fail if we can't even dispatch.
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase.from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', regenJob.id);
      return { error: String(e) };
    }
  }

  return { ok: true, jobId: regenJob.id };
}
