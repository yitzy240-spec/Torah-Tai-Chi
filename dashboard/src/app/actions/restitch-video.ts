'use server';
import { createClient } from '@/lib/supabase/server';

/**
 * Re-stitch an already-composed video with new per-cut transition choices —
 * WITHOUT re-generating any clips. Persists the operator's per-cut overrides
 * (hard cut / dissolve; absent = Auto) onto the videos row, then re-runs the
 * SAME compose job in place. Cheap: re-encode + concat only.
 *
 * settings.cuts: { "<leftClipIndex>": "hard" | "dissolve" }. Auto = omit.
 */
export async function restitchVideo(opts: {
  videoId: string;
  cuts: Record<string, 'hard' | 'fade'>;
}): Promise<{ ok: true } | { error: string }> {
  const { videoId, cuts } = opts;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: video } = await supabase
    .from('videos')
    .select('id, job_id, composed_from_clip_ids')
    .eq('id', videoId)
    .single();
  if (!video?.job_id) return { error: 'Video or its stitch job not found.' };
  const clipIds = (video.composed_from_clip_ids as unknown[] | null) ?? [];
  if (clipIds.length === 0) {
    return { error: 'This video has no stored clips to re-stitch.' };
  }

  // Keep only valid, in-range overrides.
  const clean: Record<string, 'hard' | 'fade'> = {};
  for (const [k, v] of Object.entries(cuts ?? {})) {
    const idx = Number(k);
    if (Number.isInteger(idx) && idx >= 0 && (v === 'hard' || v === 'fade')) {
      clean[String(idx)] = v;
    }
  }

  const { error: upErr } = await supabase
    .from('videos')
    .update({ stitch_settings: { cuts: clean } })
    .eq('id', videoId);
  if (upErr) {
    return { error: `Could not save transition settings: ${upErr.message}` };
  }

  // Reset the compose job out of its terminal state so Modal re-runs it
  // (compose_video early-returns "already_done" on terminal).
  await supabase
    .from('jobs')
    .update({
      status: 'queued',
      status_message: 'Re-stitching with new transitions',
      error_message: null,
      completed_at: null,
    })
    .eq('id', video.job_id);

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
      body: JSON.stringify({ compose_job_id: video.job_id }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name !== 'TimeoutError' && name !== 'AbortError') {
      await supabase.from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', video.job_id);
      return { error: String(e) };
    }
  }

  return { ok: true };
}
