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
  /** Optional override — re-render at a different resolution than the
   *  parent job. Useful when bumping a clip from 720p Fast → 1080p
   *  Standard (or going the other way for cheap drafts). When omitted,
   *  falls through to the parent job's resolution. */
  resolution?: Resolution;
  /** Optional override — re-render at a different model tier than the
   *  parent. Same fallthrough semantics as `resolution`. */
  modelTier?: ModelTier;
}): Promise<{ ok: true; jobId: string } | { error: string }> {
  const { videoId, clipIndex, resolution: resOverride, modelTier: tierOverride } = opts;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: videoRow } = await supabase
    .from('videos')
    .select('id, job_id, composed_from_clip_ids')
    .eq('id', videoId).single();
  if (!videoRow) return { error: 'Video not found' };

  // For a composed video, videos.job_id points at a compose job that
  // has NO clip rows of its own (compose uses composed_from_clip_ids
  // to reference existing clips by UUID). Walk to the source clip at
  // this slot's job so Modal's regen_clip_from_text can read a real
  // parent_clip_row. Without this we'd hit:
  //   ValueError: parent job <compose_id> has no clips
  const composedFrom = (videoRow.composed_from_clip_ids as string[] | null) ?? null;
  let parentJobId = videoRow.job_id as string;
  if (composedFrom && composedFrom.length > clipIndex) {
    const sourceClipId = composedFrom[clipIndex];
    const { data: sourceClip } = await supabase
      .from('clips').select('job_id').eq('id', sourceClipId).maybeSingle();
    if (sourceClip?.job_id) {
      parentJobId = sourceClip.job_id as string;
    }
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
