// dashboard/src/app/videos/[slug]/_data/phase-3-data.ts
//
// Data preparation for Phase 3 (Clips).
// Fetches clip rows + Tai Chi moves in parallel.
//
// Mirrors Phase 2's initialVersionsByIndex pattern: in addition to the
// plan-only's own clip rows, we fetch all clip rows under child jobs
// (regen_of_job_id = draftJobId, status = 'done'). This captures BOTH:
//   - clips-only renders fired from Phase 2 (kind = 'clips-only')
//   - per-clip regens fired from Phase 3 (kind = parent's kind, often
//     'parsha' — see regen-clip-from-text)
// Without this query, Phase 3's realtime sub on clips.job_id = jobId
// only sees the plan-only's rows. Re-renders insert new clip rows under
// the new child job_id and would be invisible to the picker.

import { createClient } from '@/lib/supabase/server';
import { listTaiChiMoves } from '@/lib/tai-chi-moves';
import type { TaiChiMove } from '@/lib/tai-chi-moves';
import type { ClipVersion } from './phase-2-data';

export type Phase3Clip = {
  id: string;
  index: number;
  storage_path: string | null;
  duration_s: number | null;
  voiceover: string;
  visual_prompt: string;
  motion_ref_slug: string | null;
  created_at: string;
};

export type Phase3Props = {
  videoId: string;
  jobId: string;
  parshaSlug: string;
  initialClips: Phase3Clip[];
  /** All rendered versions per clip index, newest first. Drives the
   *  version picker + player. Lives separately from initialClips so
   *  useRealtimeRows refetches don't clobber the overlay. */
  initialVersionsByIndex: Record<number, ClipVersion[]>;
  moves: TaiChiMove[];
};

export async function getPhase3Props(
  parshaSlug: string,
  draftJobId: string,
  draftVideoId: string,
): Promise<Phase3Props> {
  const supabase = await createClient();

  // Parallelize: clips (plan-only's own rows) + moves + child jobs.
  // The plan-only's clip rows hold canonical metadata; rendered mp4 paths
  // live in rows under child job_ids inserted by clips-only renders and
  // per-clip regens. We do TWO standalone queries (jobs.id IN ..., then
  // clips.* IN ...) rather than a PostgREST embed — the earlier embed on
  // clip_plans→jobs hit a schema-cache resolution failure in prod (Server
  // Components render error 2026-05-26). Primary-key IN queries are
  // robust and effectively as fast.
  const [clipsResult, moves, childJobsResult] = await Promise.all([
    supabase
      .from('clips')
      .select('id, index, storage_path, duration_s, voiceover, visual_prompt, motion_ref_slug, created_at')
      .eq('job_id', draftJobId)
      .order('index'),
    listTaiChiMoves(),
    supabase
      .from('jobs')
      .select('id')
      .eq('regen_of_job_id', draftJobId)
      .eq('status', 'done'),
  ]);

  const childJobIds = (childJobsResult.data ?? []).map((j) => j.id as string);
  const versionsByIndex = new Map<number, ClipVersion[]>();
  if (childJobIds.length > 0) {
    const [renderedClipsResult, jobsTierResult] = await Promise.all([
      supabase
        .from('clips')
        .select('id, index, storage_path, created_at, job_id')
        .in('job_id', childJobIds)
        .not('storage_path', 'is', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('jobs')
        .select('id, resolution, model_tier')
        .in('id', childJobIds),
    ]);
    const tierByJobId = new Map<string, { resolution: string | null; modelTier: string | null }>();
    for (const j of jobsTierResult.data ?? []) {
      tierByJobId.set(j.id as string, {
        resolution: (j.resolution as string | null) ?? null,
        modelTier: (j.model_tier as string | null) ?? null,
      });
    }
    for (const r of renderedClipsResult.data ?? []) {
      const idx = r.index as number;
      const tier = tierByJobId.get(r.job_id as string);
      const list = versionsByIndex.get(idx) ?? [];
      list.push({
        clipId: r.id as string,
        storagePath: r.storage_path as string,
        createdAt: r.created_at as string,
        resolution: tier?.resolution ?? null,
        modelTier: tier?.modelTier ?? null,
      });
      versionsByIndex.set(idx, list);
    }
  }

  const initialClips: Phase3Clip[] = (clipsResult.data ?? []).map((c) => ({
    id: c.id as string,
    index: c.index as number,
    storage_path: (c.storage_path as string | null) ?? null,
    duration_s: (c.duration_s as number | null) ?? null,
    voiceover: (c.voiceover as string | null) ?? '',
    visual_prompt: (c.visual_prompt as string | null) ?? '',
    motion_ref_slug: (c.motion_ref_slug as string | null) ?? null,
    created_at: (c.created_at as string | null) ?? new Date(0).toISOString(),
  }));
  const initialVersionsByIndex: Record<number, ClipVersion[]> = Object.fromEntries(versionsByIndex);

  return {
    videoId: draftVideoId,
    jobId: draftJobId,
    parshaSlug,
    initialClips,
    initialVersionsByIndex,
    moves,
  };
}
