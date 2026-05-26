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

export type Phase2Props = {
  parshaSlug: string;
  jobId: string;
  clipPlanId: string;
  initialClips: Phase2Clip[];
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

  // Build the storage_path overlay: for each clip index, the most recent
  // rendered mp4 path from any done clips-only child job. Newest wins.
  const clipsOnlyJobIds = (clipsOnlyJobsResult.data ?? []).map((j) => j.id as string);
  const renderedByIndex = new Map<number, string>();
  if (clipsOnlyJobIds.length > 0) {
    const { data: renderedClips } = await supabase
      .from('clips')
      .select('index, storage_path, created_at')
      .in('job_id', clipsOnlyJobIds)
      .not('storage_path', 'is', null)
      .order('created_at', { ascending: false });
    for (const r of renderedClips ?? []) {
      const idx = r.index as number;
      if (!renderedByIndex.has(idx)) {
        renderedByIndex.set(idx, r.storage_path as string);
      }
    }
  }

  const initialClips: Phase2Clip[] = (clipsResult.data ?? []).map((c) => ({
    id: c.id as string,
    index: c.index as number,
    voiceover: (c.voiceover as string | null) ?? '',
    visual_prompt: (c.visual_prompt as string | null) ?? '',
    duration_s: (c.duration_s as number | null) ?? null,
    // Prefer a rendered path from a clips-only child job; fall back to
    // the plan-only's own storage_path field (always null today but
    // future-proof if Modal ever writes it).
    storage_path: renderedByIndex.get(c.index as number) ?? (c.storage_path as string | null) ?? null,
    motion_ref_slug: (c.motion_ref_slug as string | null) ?? null,
    reference_image_paths: (c.reference_image_paths as string[] | null) ?? null,
    chain_broken: (c.chain_broken as boolean | null) ?? false,
  }));

  const draftJobDetails = jobDetailsResult.data;
  const resolution = (draftJobDetails?.resolution as Resolution | null) ?? '720p';
  const modelTier = (draftJobDetails?.model_tier as ModelTier | null) ?? 'standard';

  return {
    parshaSlug,
    jobId: draftJobId,
    clipPlanId,
    initialClips,
    initialResolution: resolution,
    initialModelTier: modelTier,
    moves,
    refImageLibrary: getRefImageLibrary(),
  };
}
