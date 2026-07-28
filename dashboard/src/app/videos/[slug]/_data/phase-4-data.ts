// dashboard/src/app/videos/[slug]/_data/phase-4-data.ts
//
// Data preparation for Phase 4 (Stitched video preview).
// Fetches video row + clip plan + clip rows in parallel, builds the captions
// VTT + clip boundaries, and computes the auto transition type for each cut
// (hard within a scene, dissolve at a scene break) for the Transitions control.

import { createClient } from '@/lib/supabase/server';
import { buildClipPayload } from '@/lib/clip-payload';

export type CutType = 'hard' | 'fade';

export type Phase4Props = {
  videoId: string;
  videoMp4Path: string | null;
  thumbPath: string | null;
  composeJobId: string | null;
  /** jobs.status for the compose/render job, read server-side. The failed
   * state MUST be renderable from the DB row alone: the 2026-07-28 Eikev
   * incident had compose crash before broadcasting 'failed', so a client
   * that only trusts the realtime event shows "Stitching…" forever — through
   * every refresh, all night. */
  composeJobStatus: string | null;
  composeJobError: string | null;
  captionsVttDataUrl: string | null;
  clipBoundariesS: number[];
  totalDurationS: number;
  /** Auto transition type per cut (index i = cut after clip i). */
  autoCutTypes: CutType[];
  /** Operator per-cut overrides from stitch_settings.cuts. */
  cutOverrides: Record<string, CutType>;
};

type ClipMeta = { setting_id: string | null; motion_ref_slug: string | null };

// Mirror of stitcher.auto_cut_type: dissolve at a scene break — the incoming
// clip can't be frame-chained (motion-ref) or the setting changes.
function autoCut(prev: ClipMeta, curr: ClipMeta): CutType {
  if (curr.motion_ref_slug) return 'fade';
  if (prev.setting_id !== curr.setting_id) return 'fade';
  return 'hard';
}

export async function getPhase4Props(
  draftJobId: string,
  draftVideoId: string,
  clipPlanId: string | null,
): Promise<Phase4Props> {
  const supabase = await createClient();

  const [videoResult, planResult, clipsResult, jobResult] = await Promise.all([
    supabase.from('videos').select('id, mp4_path, thumb_path, job_id, stitch_settings, composed_from_clip_ids').eq('id', draftVideoId).single(),
    clipPlanId
      ? supabase.from('clip_plans').select('plan_json').eq('id', clipPlanId).single()
      : Promise.resolve({ data: null }),
    supabase.from('clips').select('id, index').eq('job_id', draftJobId).order('index'),
    supabase.from('jobs').select('status, error_message').eq('id', draftJobId).maybeSingle(),
  ]);

  const videoRow = videoResult.data as {
    id: string; mp4_path: string | null; thumb_path: string | null; job_id: string | null;
    stitch_settings: { cuts?: Record<string, CutType> } | null;
    composed_from_clip_ids: string[] | null;
  } | null;
  const videoMp4Path = videoRow?.mp4_path ?? null;
  const thumbPath = videoRow?.thumb_path ?? null;
  const composeJobId = videoRow?.job_id ?? null;
  const jobRow = jobResult.data as { status: string | null; error_message: string | null } | null;
  const composeJobStatus = jobRow?.status ?? null;
  const composeJobError = jobRow?.error_message ?? null;

  const cutOverrides: Record<string, CutType> = {};
  for (const [k, v] of Object.entries(videoRow?.stitch_settings?.cuts ?? {})) {
    if (v === 'hard' || v === 'fade') cutOverrides[k] = v;
  }

  // Clip boundaries (scrub markers + per-cut controls) come from the clip
  // plan for normal renders. COMPOSE videos have no clip plan and their clips
  // live under their original job_ids — so synthesize the plan from the
  // composed clips' own duration_s / voiceover, and pull setting_id /
  // motion_ref_slug so we can auto-type each cut.
  let planJson: unknown = planResult.data?.plan_json ?? null;
  let clipRowsForBoundaries: Array<{ id: string; index: number }> = (clipsResult.data ?? []).map(
    (c) => ({ id: c.id as string, index: c.index as number }),
  );
  let orderedMeta: ClipMeta[] = [];

  const composedIds = videoRow?.composed_from_clip_ids ?? null;
  if (composedIds && composedIds.length > 0) {
    const { data: composed } = await supabase
      .from('clips')
      .select('id, index, duration_s, voiceover, setting_id, motion_ref_slug')
      .in('id', composedIds);
    const rows = (composed ?? []).slice().sort(
      (a, b) => (a.index as number) - (b.index as number),
    );
    planJson = {
      clips: rows.map((r) => ({
        index: r.index as number,
        duration_s: (r.duration_s as number | null) ?? 0,
        voiceover: (r.voiceover as string | null) ?? '',
      })),
    };
    clipRowsForBoundaries = rows.map((r) => ({ id: r.id as string, index: r.index as number }));
    orderedMeta = rows.map((r) => ({
      setting_id: (r.setting_id as string | null) ?? null,
      motion_ref_slug: (r.motion_ref_slug as string | null) ?? null,
    }));
  }

  const { captionsVttDataUrl, clipBoundariesS, totalDurationS } = buildClipPayload(
    planJson,
    clipRowsForBoundaries,
  );

  const cutCount = Math.max(0, clipBoundariesS.length - 1);
  const autoCutTypes: CutType[] = [];
  for (let i = 0; i < cutCount; i++) {
    autoCutTypes.push(
      orderedMeta.length > i + 1 ? autoCut(orderedMeta[i], orderedMeta[i + 1]) : 'hard',
    );
  }

  return {
    videoId: draftVideoId,
    videoMp4Path,
    thumbPath,
    composeJobId,
    composeJobStatus,
    composeJobError,
    captionsVttDataUrl,
    clipBoundariesS,
    totalDurationS,
    autoCutTypes,
    cutOverrides,
  };
}
