'use server';
import { createClient } from '@/lib/supabase/server';

/**
 * Re-stitch an already-composed video with new transition settings —
 * WITHOUT re-generating any clips. Persists the operator's Auto/Tighter/
 * Looser choice (+ any per-cut overrides) onto the videos row, then re-runs
 * the SAME compose job in place (Modal reads the settings and overwrites
 * jobs/{compose_job_id}/final.mp4). Cheap: re-encode + concat only.
 *
 * settings shape: { level: -2..2, joins?: { "<leftClipIndex>": -2..2 } }.
 * level 0 = Auto. joins holds only cuts that differ from the global level.
 */
export async function restitchVideo(opts: {
  videoId: string;
  settings: { level: number; joins?: Record<string, number> };
}): Promise<{ ok: true } | { error: string }> {
  const { videoId, settings } = opts;
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

  // Normalize: clamp global level, and keep only per-cut overrides that
  // actually differ from the global (else they're redundant — the cut
  // already follows global).
  const level = Math.max(-2, Math.min(2, Math.round(settings.level ?? 0)));
  const joins: Record<string, number> = {};
  for (const [k, v] of Object.entries(settings.joins ?? {})) {
    const idx = Number(k);
    const lvl = Math.max(-2, Math.min(2, Math.round(Number(v))));
    if (Number.isInteger(idx) && idx >= 0 && lvl !== level) {
      joins[String(idx)] = lvl;
    }
  }
  const stitchSettings = { level, joins };

  const { error: upErr } = await supabase
    .from('videos')
    .update({ stitch_settings: stitchSettings })
    .eq('id', videoId);
  if (upErr) {
    return { error: `Could not save transition settings: ${upErr.message}` };
  }

  // Reset the compose job out of its terminal state so Modal actually
  // re-runs it (compose_video early-returns "already_done" on terminal).
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
    // Timeout/abort is expected — Modal keeps running server-side.
  }

  return { ok: true };
}
