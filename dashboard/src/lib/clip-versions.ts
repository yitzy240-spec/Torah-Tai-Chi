import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClipVersion {
  clipId: string;
  jobId: string;
  index: number;
  voiceover: string | null;
  visualPrompt: string | null;
  storagePath: string | null;
  createdAt: string;
}

export interface ClipVersionsResult {
  parshaId: string;
  /** A representative non-compose job id for this parsha — used by
   *  the compose action to copy generation parameters (motion_ref_slug,
   *  resolution, etc.). Latest done job, or first if none done yet. */
  representativeJobId: string;
  versionsByIndex: Map<number, ClipVersion[]>;
}

/**
 * Get every clip version produced for a given parsha across all
 * generation runs and all regen trees. Excludes compose jobs (which
 * don't generate new clips, they reuse existing ones). Versions
 * within an index are ordered oldest -> newest.
 *
 * Mirrors the version-collection pattern in /videos/[slug]/page.tsx
 * but flattens to clip-level instead of video-level.
 */
export async function getClipVersionsByParsha(
  supabase: SupabaseClient,
  parshaId: string,
): Promise<ClipVersionsResult | null> {
  const { data: jobRows } = await supabase
    .from('jobs')
    .select('id, kind, status, triggered_at')
    .eq('parsha_id', parshaId)
    .order('triggered_at', { ascending: true });

  const nonComposeJobs = (jobRows ?? []).filter(
    (j: { kind: string | null }) => (j.kind ?? 'parsha') !== 'compose',
  );
  if (nonComposeJobs.length === 0) return null;

  // Pick a representative job — prefer the latest done one, else the
  // latest queued/processing one. compose-video.ts uses this for
  // generation-parameter lookup.
  const doneJobs = nonComposeJobs.filter(
    (j: { status: string | null }) => j.status === 'done',
  );
  const representative = doneJobs.length > 0
    ? doneJobs[doneJobs.length - 1]
    : nonComposeJobs[nonComposeJobs.length - 1];

  const jobIds = nonComposeJobs.map((j: { id: string }) => j.id);
  const { data: clipRows } = await supabase
    .from('clips')
    .select('id, job_id, index, voiceover, visual_prompt, storage_path, created_at')
    .in('job_id', jobIds)
    .order('index')
    .order('created_at');

  const versionsByIndex = new Map<number, ClipVersion[]>();
  for (const row of clipRows ?? []) {
    if (!row.storage_path) continue; // skip in-flight / failed clip rows
    const v: ClipVersion = {
      clipId: row.id as string,
      jobId: row.job_id as string,
      index: row.index as number,
      voiceover: row.voiceover as string | null,
      visualPrompt: row.visual_prompt as string | null,
      storagePath: row.storage_path as string | null,
      createdAt: row.created_at as string,
    };
    const arr = versionsByIndex.get(v.index) ?? [];
    arr.push(v);
    versionsByIndex.set(v.index, arr);
  }
  return {
    parshaId,
    representativeJobId: representative.id as string,
    versionsByIndex,
  };
}
