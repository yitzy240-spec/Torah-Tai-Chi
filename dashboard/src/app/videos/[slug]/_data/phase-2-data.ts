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

/** One rendered version of a clip index — every render under a child
 *  job (clips-only from Phase 2, or regen-from-text from Phase 3)
 *  produces a new ClipVersion. Operator picks among them via the
 *  version chips on the Phase 2 card. */
export type ClipVersion = {
  clipId: string;
  storagePath: string;
  createdAt: string;
  resolution: string | null;
  modelTier: string | null;
};

/** An in-flight clips-only render targeting this clip index. Surfaced
 *  from the server so a tab reload (or a tab open from cold) still
 *  shows the spinner instead of dropping the operator back onto a
 *  Re-render button that re-fires Modal. Newest job wins if more than
 *  one is pending for the same index. */
export type PendingRender = {
  jobId: string;
  startedAt: string;
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
  /** In-flight clips-only renders per index. The clip card seeds its
   *  rendering spinner from this on mount so refresh-mid-render no
   *  longer shows an idle Re-render button. */
  initialPendingByIndex: Record<number, PendingRender>;
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
  // + child jobs (so we can overlay rendered versions from any child
  // job). The plan-only's clip rows hold canonical metadata (voiceover,
  // scene direction, motion ref, refs, chain_broken). When the operator
  // renders a clip via the per-card or 'Generate remaining' CTA, Modal
  // inserts NEW clip rows under the child job_id with storage_path set.
  // Without the overlay below, the Phase 2 cards keep showing 'Generate
  // this clip' even after the render succeeded — they're reading the
  // plan-only rows which never get a storage_path.
  //
  // NOTE: the child-jobs query OMITS a kind filter. Phase 3's regen-
  // from-text path (regenClipFromText) creates child jobs whose kind
  // inherits the parent ('parsha' or 'plan-only'), not 'clips-only'.
  // Filtering by kind='clips-only' would make those regen renders
  // invisible to Phase 2's chip row. Mirror Phase 3's data fetcher
  // (phase-3-data.ts:7-14): rendered versions from ANY child job,
  // identified solely by regen_of_job_id + status='done'.
  // Pending clips-only jobs use the same regen_of_job_id link as the
  // done jobs above. We exclude terminal statuses (done/failed/cancelled)
  // — anything else (queued, generating_clips, etc.) is in-flight and
  // the operator MUST see a spinner for it. Without this query, a refresh
  // mid-render wipes the local React spinner state and the card snaps
  // back to "Re-render", inviting the operator to fire Modal a second
  // time on the same clip (Yonah's 2026-06-02 Beha'alotcha clip-4 report).
  const [clipsResult, jobDetailsResult, moves, clipsOnlyJobsResult, pendingJobsResult] =
    await Promise.all([
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
        .eq('status', 'done'),
      supabase
        .from('jobs')
        .select('id, clip_indexes, triggered_at')
        .eq('regen_of_job_id', draftJobId)
        .eq('kind', 'clips-only')
        .not('status', 'in', '(done,failed,cancelled)')
        .order('triggered_at', { ascending: false }),
    ]);

  // Build the per-index version list: every rendered clip row under any
  // done child job (any kind). Ordered newest-first so the default
  // selection (chips[0]) is always the most recent render. The job's
  // resolution / model_tier are joined client-side after a separate
  // jobs SELECT — using a PostgREST embed for this caused a schema-
  // cache resolution failure in prod on the earlier clip_plans→jobs
  // embed (Server Components render error 2026-05-26). Two queries by
  // primary key are robust and effectively as fast.
  const clipsOnlyJobIds = (clipsOnlyJobsResult.data ?? []).map((j) => j.id as string);
  const versionsByIndex = new Map<number, ClipVersion[]>();
  if (clipsOnlyJobIds.length > 0) {
    const [renderedClipsResult, jobsTierResult] = await Promise.all([
      supabase
        .from('clips')
        .select('id, index, storage_path, created_at, job_id')
        .in('job_id', clipsOnlyJobIds)
        .not('storage_path', 'is', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('jobs')
        .select('id, resolution, model_tier')
        .in('id', clipsOnlyJobIds),
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

  // Walk pending jobs newest-first; first job to claim an index wins. A
  // clips-only row with clip_indexes=NULL means "all clips" (the bulk
  // "Generate all"/"Generate remaining" path), so we stamp every plan
  // index. The loop is small (in practice 0 or 1 pending jobs) so the
  // O(jobs * clips) walk is negligible.
  const planIndexes = initialClips.map((c) => c.index);
  const initialPendingByIndex: Record<number, PendingRender> = {};
  for (const j of pendingJobsResult.data ?? []) {
    const indexes =
      (j.clip_indexes as number[] | null) === null ? planIndexes : (j.clip_indexes as number[]);
    for (const idx of indexes) {
      if (initialPendingByIndex[idx]) continue; // newer job already claimed
      initialPendingByIndex[idx] = {
        jobId: j.id as string,
        startedAt: j.triggered_at as string,
      };
    }
  }

  const draftJobDetails = jobDetailsResult.data;
  const resolution = (draftJobDetails?.resolution as Resolution | null) ?? '720p';
  const modelTier = (draftJobDetails?.model_tier as ModelTier | null) ?? 'standard';

  return {
    parshaSlug,
    jobId: draftJobId,
    clipPlanId,
    initialClips,
    initialVersionsByIndex,
    initialPendingByIndex,
    initialResolution: resolution,
    initialModelTier: modelTier,
    moves,
    refImageLibrary: getRefImageLibrary(),
  };
}
