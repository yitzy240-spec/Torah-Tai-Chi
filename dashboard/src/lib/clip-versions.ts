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
  rootJobId: string;
  versionsByIndex: Map<number, ClipVersion[]>;
}

/**
 * Walk the regen tree starting from `rootJobId` and return every clip
 * version (across the original job and all regens), grouped by clip
 * index. Versions within an index are ordered oldest -> newest.
 *
 * Compose jobs are excluded — they don't generate new clip mp4s,
 * they reuse existing ones.
 */
export async function getClipVersions(
  supabase: SupabaseClient,
  rootJobId: string,
): Promise<ClipVersionsResult> {
  const allJobIds: string[] = [rootJobId];
  let frontier: string[] = [rootJobId];
  for (let i = 0; i < 64; i++) {
    if (frontier.length === 0) break;
    const { data } = await supabase
      .from('jobs')
      .select('id, kind')
      .in('regen_of_job_id', frontier);
    const next = (data ?? [])
      .filter((r: { kind: string | null }) => (r.kind ?? 'parsha') !== 'compose')
      .map((r: { id: string }) => r.id);
    if (next.length === 0) break;
    allJobIds.push(...next);
    frontier = next;
  }

  const { data: clipRows } = await supabase
    .from('clips')
    .select('id, job_id, index, voiceover, visual_prompt, storage_path, created_at')
    .in('job_id', allJobIds)
    .order('index')
    .order('created_at');

  const versionsByIndex = new Map<number, ClipVersion[]>();
  for (const row of clipRows ?? []) {
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
  return { rootJobId, versionsByIndex };
}
