// dashboard/src/app/videos/[slug]/_data/phase-4-data.ts
//
// Data preparation for Phase 4 (Stitched video preview).
// Fetches video row + clip plan + clip rows in parallel, then builds the
// captions VTT + clip boundary data via buildClipPayload.

import { createClient } from '@/lib/supabase/server';
import { buildClipPayload } from '@/lib/clip-payload';

export type Phase4Props = {
  videoId: string;
  videoMp4Path: string | null;
  thumbPath: string | null;
  composeJobId: string | null;
  captionsVttDataUrl: string | null;
  clipBoundariesS: number[];
  totalDurationS: number;
};

export async function getPhase4Props(
  draftJobId: string,
  draftVideoId: string,
  clipPlanId: string | null,
): Promise<Phase4Props> {
  const supabase = await createClient();

  // Parallelize: video row + clip plan + clip rows — all independent
  const [videoResult, planResult, clipsResult] = await Promise.all([
    supabase.from('videos').select('id, mp4_path, thumb_path, job_id').eq('id', draftVideoId).single(),
    clipPlanId
      ? supabase.from('clip_plans').select('plan_json').eq('id', clipPlanId).single()
      : Promise.resolve({ data: null }),
    supabase.from('clips').select('id, index').eq('job_id', draftJobId).order('index'),
  ]);

  // The compose job that owns this video — needed for failure detection
  // in the UI. The video row exists immediately on insert with empty
  // mp4_path; Modal updates mp4_path on success or jobs.status='failed'
  // + error_message on crash. Phase 4 subscribes to both.
  const videoRow = videoResult.data as { id: string; mp4_path: string | null; thumb_path: string | null; job_id: string | null } | null;
  const videoMp4Path = videoRow?.mp4_path ?? null;
  const thumbPath = videoRow?.thumb_path ?? null;
  const composeJobId = videoRow?.job_id ?? null;
  const planJson = planResult.data?.plan_json ?? null;
  const clipRowsForBoundaries: Array<{ id: string; index: number }> = (clipsResult.data ?? []).map(
    (c) => ({
      id: c.id as string,
      index: c.index as number,
    }),
  );

  const { captionsVttDataUrl, clipBoundariesS, totalDurationS } = buildClipPayload(
    planJson,
    clipRowsForBoundaries,
  );

  return {
    videoId: draftVideoId,
    videoMp4Path,
    thumbPath,
    composeJobId,
    captionsVttDataUrl,
    clipBoundariesS,
    totalDurationS,
  };
}
