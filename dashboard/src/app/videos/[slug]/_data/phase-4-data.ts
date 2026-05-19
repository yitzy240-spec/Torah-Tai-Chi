// dashboard/src/app/videos/[slug]/_data/phase-4-data.ts
//
// Data preparation for Phase 4 (Stitched video preview).
// Fetches video row + clip plan + clip rows in parallel, then builds the
// captions VTT + clip boundary data via buildClipPayload.

import { createClient } from '@/lib/supabase/server';
import { buildClipPayload } from '@/lib/clip-payload';

export type Phase4Props = {
  videoMp4Path: string | null;
  thumbPath: string | null;
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
    supabase.from('videos').select('mp4_path, thumb_path').eq('id', draftVideoId).single(),
    clipPlanId
      ? supabase.from('clip_plans').select('plan_json').eq('id', clipPlanId).single()
      : Promise.resolve({ data: null }),
    supabase.from('clips').select('id, index').eq('job_id', draftJobId).order('index'),
  ]);

  const videoMp4Path = (videoResult.data?.mp4_path as string | null) ?? null;
  const thumbPath = (videoResult.data?.thumb_path as string | null) ?? null;
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
    videoMp4Path,
    thumbPath,
    captionsVttDataUrl,
    clipBoundariesS,
    totalDurationS,
  };
}
