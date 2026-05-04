'use server';
import { createClient } from '@/lib/supabase/server';

/**
 * Triggers a no-AI re-render of one clip. Inserts a regen job pointing
 * at the parent (so Modal's regen_clip_from_text reads the parent's
 * stored voiceover/visual_prompt — both fields the user just saved via
 * update-clip-text.ts), then dispatches the Modal endpoint.
 */
export async function regenClipFromText(opts: {
  videoId: string;
  clipIndex: number;
}): Promise<{ ok: true; jobId: string } | { error: string }> {
  const { videoId, clipIndex } = opts;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: videoRow } = await supabase
    .from('videos').select('id, job_id').eq('id', videoId).single();
  if (!videoRow) return { error: 'Video not found' };
  const parentJobId = videoRow.job_id as string;

  const { data: parentJob } = await supabase
    .from('jobs')
    .select('parsha_id, script_id, resolution, model_tier, motion_ref_slug, partner_parsha_id, kind, topic')
    .eq('id', parentJobId).single();
  if (!parentJob) return { error: 'Parent job not found' };

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
      resolution: parentJob.resolution,
      model_tier: parentJob.model_tier,
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
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase.from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', regenJob.id);
      return { error: String(e) };
    }
  }

  return { ok: true, jobId: regenJob.id };
}
