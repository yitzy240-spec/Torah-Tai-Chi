'use server';
import { createClient } from '@/lib/supabase/server';

/**
 * Compose: stitch a user-chosen ordered list of clip_ids into a new
 * video. Clip_ids must:
 *   - cover every slot index 0..N-1 exactly once, in slot order
 *   - all have storage_path set
 *
 * `referenceJobId` is any non-compose job for the parsha (the dashboard
 * picks the latest done one). compose-video copies its generation
 * parameters (motion_ref_slug, resolution, etc.) onto the new compose
 * job.
 *
 * On success, queues a Modal compose job and returns the new video_id.
 */
export async function composeVideo(opts: {
  referenceJobId: string;
  /** Clip UUIDs in slot order (index 0 first, then 1, etc.). */
  clipIds: string[];
}): Promise<{ ok: true; videoId: string; jobId: string } | { error: string }> {
  const { referenceJobId, clipIds } = opts;
  if (clipIds.length === 0) {
    return { error: 'Pick at least one clip per slot.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Validate: all referenced clips exist, indices match slot order,
  // every clip has a storage_path.
  const { data: clipRows } = await supabase
    .from('clips')
    .select('id, index, storage_path, job_id')
    .in('id', clipIds);
  if (!clipRows || clipRows.length !== clipIds.length) {
    return { error: 'One or more clips not found.' };
  }
  const byId = new Map(clipRows.map(r => [r.id as string, r]));
  for (let slot = 0; slot < clipIds.length; slot++) {
    const r = byId.get(clipIds[slot]);
    if (!r) return { error: `Clip ${clipIds[slot]} missing.` };
    if (r.index !== slot) {
      return {
        error: `Clip at slot ${slot} has index ${r.index}, expected ${slot}.`,
      };
    }
    if (!r.storage_path) {
      return { error: `Clip ${r.id} has no stored mp4 yet.` };
    }
  }

  const { data: refJob } = await supabase
    .from('jobs')
    .select(
      'id, parsha_id, script_id, motion_ref_slug, model_tier, resolution, ' +
      'partner_parsha_id, topic',
    )
    .eq('id', referenceJobId).single();
  if (!refJob) return { error: 'Reference job not found.' };

  const { data: composeJob } = await supabase
    .from('jobs').insert({
      parsha_id: refJob.parsha_id,
      script_id: refJob.script_id,
      partner_parsha_id: refJob.partner_parsha_id ?? null,
      motion_ref_slug: refJob.motion_ref_slug ?? null,
      resolution: refJob.resolution ?? '720p',
      model_tier: refJob.model_tier ?? 'standard',
      kind: 'compose',
      topic: refJob.topic ?? null,
      regen_of_job_id: referenceJobId,
      status: 'queued',
      triggered_by: user.id,
    }).select('id').single();
  if (!composeJob) return { error: 'Could not queue compose job.' };

  // Insert videos row up front so compose_video can read clip_ids
  // off it. mp4_path is a placeholder until stitch finishes.
  const { data: videoRow } = await supabase
    .from('videos').insert({
      job_id: composeJob.id,
      mp4_path: '',
      composed_from_clip_ids: clipIds,
    }).select('id').single();
  if (!videoRow) return { error: 'Could not create video record.' };

  const baseTriggerUrl = process.env.MODAL_WORKER_URL;
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!baseTriggerUrl || !triggerSecret) {
    return { error: 'Modal config missing.' };
  }
  const workerUrl = baseTriggerUrl.replace(
    'pipeline-trigger', 'pipeline-compose-video-endpoint',
  );
  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
      body: JSON.stringify({ compose_job_id: composeJob.id }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if ((e as Error).name !== 'TimeoutError'
        && (e as Error).name !== 'AbortError') {
      await supabase.from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', composeJob.id);
      return { error: String(e) };
    }
  }

  return { ok: true, videoId: videoRow.id as string, jobId: composeJob.id as string };
}
