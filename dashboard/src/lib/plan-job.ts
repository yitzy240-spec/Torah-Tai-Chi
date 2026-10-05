// dashboard/src/lib/plan-job.ts
//
// Which plan-only job a Phase 2 (clips) page edits.

export interface PlanJobLink {
  id: string;
  /** Parent job for clips-only / compose / regen jobs; NULL on a plan-only root. */
  regenOfJobId: string | null;
}

/**
 * Walk up the regen_of_job_id chain to find the plan-only ancestor.
 *
 * Why: `state.draftJobId` is whatever job most recently advanced the
 * draft. Once a compose job exists, that becomes the draftJobId — but
 * the compose job owns the stitched mp4, not the editable clip
 * metadata. Phase 2 (plan review) and Phase 3 (clips) MUST operate on
 * the plan-only root, because that's where the per-clip
 * voiceover/visual_prompt/motion_ref_slug rows live. Without this
 * traversal, navigating BACK to Phase 2 or 3 from Phase 4 or 5
 * (Yonah's 2026-06-01 "back to clips" report) lands on the compose
 * job's empty clip set and renders nothing.
 *
 * Returns the input id if it's already a plan-only / root (regenOfJobId
 * is null), or null if the chain breaks.
 */
export function resolvePlanJobId(
  jobs: readonly PlanJobLink[],
  jobId: string | null,
): string | null {
  if (!jobId) return null;
  let current: string | null = jobId;
  const seen = new Set<string>();
  while (current !== null) {
    if (seen.has(current)) return null; // cycle guard, shouldn't happen
    seen.add(current);
    const job = jobs.find((j) => j.id === current);
    if (!job) return null;
    if (!job.regenOfJobId) return current; // root reached
    current = job.regenOfJobId;
  }
  return null;
}

/**
 * The plan Phase 2 shows: the draft's, or the LIVE video's.
 *
 * Yonah, 2026-10-05: "I want to fix something in the video, so I need to get
 * back to the page with the clips. I can't find it because I've already
 * stitched it and published it to the website." Once a video is published
 * there is no draft, so Phase 2 had nothing to point at — a bare ?phase=2
 * spun on "Starting clip plan…" forever, and "Replace with a new version"
 * starts over from the script (new plan, every clip rendered again).
 *
 * The live video's plan is the one he means. Its clips — every version — are
 * still there. Re-rendering one and stitching again produces a compose job on
 * the same plan, so the same teaching, so publishing it takes the old video
 * down (set-video-published, one published video per teaching).
 *
 *   - editLive: the live page's "Edit clips" link asked for the live plan
 *     explicitly — wins even when an unrelated draft exists.
 *   - otherwise the draft's plan, as before;
 *   - and with no draft at all, the live plan rather than a dead spinner.
 *     Not while starting a plan from Phase 1 (startPlan): that path decides
 *     for itself whether to build a new one.
 */
export function editablePlanJobId(args: {
  jobs: readonly PlanJobLink[];
  draftJobId: string | null;
  liveJobId: string | null;
  editLive: boolean;
  startPlan: boolean;
}): string | null {
  const { jobs, draftJobId, liveJobId, editLive, startPlan } = args;
  const livePlan = resolvePlanJobId(jobs, liveJobId);
  if (editLive && livePlan) return livePlan;
  const draftPlan = resolvePlanJobId(jobs, draftJobId);
  if (draftPlan) return draftPlan;
  if (startPlan) return null;
  return livePlan;
}
