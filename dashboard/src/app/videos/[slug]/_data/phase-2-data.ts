// dashboard/src/app/videos/[slug]/_data/phase-2-data.ts
//
// Data preparation for Phase 2 (Plan review).
// Fetches clips + job resolution/tier + Tai Chi moves in parallel.

import { createClient } from '@/lib/supabase/server';
import { listTaiChiMoves } from '@/lib/tai-chi-moves';
import { getRefImageLibrary } from '@/lib/ref-image-library';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';
import type { TaiChiMove } from '@/lib/tai-chi-moves';
import type { RefImage } from '@/app/videos/[slug]/_components/_shared/reference-image-picker-sheet';

export type Phase2Clip = {
  id: string;
  index: number;
  voiceover: string;
  visual_prompt: string;
  duration_s: number | null;
  storage_path: string | null;
  motion_ref_slug: string | null;
  reference_image_paths: string[] | null;
  chain_broken: boolean;
};

/** One rendered version of a clip index — every clips-only render of
 *  the same index produces a new ClipVersion. Operator picks among
 *  them via the version chips on the Phase 2 card. */
export type ClipVersion = {
  clipId: string;
  storagePath: string;
  createdAt: string;
  resolution: string | null;
  modelTier: string | null;
};

export type Phase2Props = {
  parshaSlug: string;
  jobId: string;
  clipPlanId: string;
  initialClips: Phase2Clip[];
  /** All rendered versions per clip index, newest first. Drives the
   *  version chips + player source. Lives separately from initialClips
   *  so useRealtimeRows refetches don't clobber the overlay. */
  initialVersionsByIndex: Record<number, ClipVersion[]>;
  initialResolution: Resolution;
  initialModelTier: ModelTier;
  moves: TaiChiMove[];
  refImageLibrary: RefImage[];
};

export async function getPhase2Props(
  parshaSlug: string,
  draftJobId: string,
  clipPlanId: string,
): Promise<Phase2Props> {
  const supabase = await createClient();

  // Parallelize: clips + job details (resolution/tier) + tai-chi moves
  // + clips-only child jobs (so we can overlay rendered storage_paths).
  // The plan-only's clip rows hold canonical metadata (voiceover, scene
  // direction, motion ref, refs, chain_broken). When the operator
  // renders a clip via the per-card or 'Generate remaining' CTA, Modal
  // inserts NEW clip rows under the clips-only job_id with storage_path
  // set. Without the overlay below, the Phase 2 cards keep showing
  // 'Generate this clip' even after the render succeeded — they're
  // reading the plan-only rows which never get a storage_path.
  const [clipsResult, jobDetailsResult, moves, clipsOnlyJobsResult] = await Promise.all([
    supabase
      .from('clips')
      .select('id, index, voiceover, visual_prompt, duration_s, storage_path, motion_ref_slug, reference_image_paths, chain_broken')
      .eq('job_id', draftJobId)
      .order('index'),
    supabase.from('jobs').select('resolution, model_tier').eq('id', draftJobId).single(),
    listTaiChiMoves(),
    supabase
      .from('jobs')
      .select('id')
      .eq('regen_of_job_id', draftJobId)
      .eq('kind', 'clips-only')
      .eq('status', 'done'),
  ]);

  // Build the per-index version list: every rendered clip row under any
  // done clips-only child job. Ordered newest-first so the default
  // selection (chips[0]) is always the most recent render. The job's
  // resolution / model_tier are joined so the chips can show 'v2 · 480p
  // Fast' style labels without an extra round-trip.
  const clipsOnlyJobIds = (clipsOnlyJobsResult.data ?? []).map((j) => j.id as string);
  const versionsByIndex = new Map<number, ClipVersion[]>();
  if (clipsOnlyJobIds.length > 0) {
    const { data: renderedClips } = await supabase
      .from('clips')
      .select('id, index, storage_path, created_at, jobs!inner(resolution, model_tier)')
      .in('job_id', clipsOnlyJobIds)
      .not('storage_path', 'is', null)
      .order('created_at', { ascending: false });
    for (const r of renderedClips ?? []) {
      const idx = r.index as number;
      // Embedded join returns 'jobs' as object OR array depending on
      // PostgREST relation cardinality. Normalize.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobsRel = (r as any).jobs;
      const job = Array.isArray(jobsRel) ? jobsRel[0] : jobsRel;
      const list = versionsByIndex.get(idx) ?? [];
      list.push({
        clipId: r.id as string,
        storagePath: r.storage_path as string,
        createdAt: r.created_at as string,
        resolution: (job?.resolution as string | null) ?? null,
        modelTier: (job?.model_tier as string | null) ?? null,
      });
      versionsByIndex.set(idx, list);
    }
  }

  // initialClips holds the plan-only's editable metadata only. Don't
  // overlay storage_path here — useRealtimeRows would clobber it on
  // refetch. The component merges initialVersionsByIndex at display
  // time (selection drives the player; chips drive selection).
  const initialClips: Phase2Clip[] = (clipsResult.data ?? []).map((c) => ({
    id: c.id as string,
    index: c.index as number,
    voiceover: (c.voiceover as string | null) ?? '',
    visual_prompt: (c.visual_prompt as string | null) ?? '',
    duration_s: (c.duration_s as number | null) ?? null,
    storage_path: (c.storage_path as string | null) ?? null,
    motion_ref_slug: (c.motion_ref_slug as string | null) ?? null,
    reference_image_paths: (c.reference_image_paths as string[] | null) ?? null,
    chain_broken: (c.chain_broken as boolean | null) ?? false,
  }));
  const initialVersionsByIndex: Record<number, ClipVersion[]> = Object.fromEntries(versionsByIndex);

  const draftJobDetails = jobDetailsResult.data;
  const resolution = (draftJobDetails?.resolution as Resolution | null) ?? '720p';
  const modelTier = (draftJobDetails?.model_tier as ModelTier | null) ?? 'standard';

  return {
    parshaSlug,
    jobId: draftJobId,
    clipPlanId,
    initialClips,
    initialVersionsByIndex,
    initialResolution: resolution,
    initialModelTier: modelTier,
    moves,
    refImageLibrary: getRefImageLibrary(),
  };
}
