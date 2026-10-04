// dashboard/src/lib/teaching.ts
//
// A TEACHING is one script's take on a parsha. Re-rendering, re-stitching or
// re-composing it produces new VERSIONS of the same teaching; writing a new
// script — next year's, or another idea this year — starts a new teaching.
//
// The website keeps every teaching it has ever published (the newest is the
// hero, the rest sit behind "Earlier teachings"), but only the latest version
// of each. So publishing has to tell "a newer cut of this teaching" (replace
// it) apart from "a different teaching" (leave it published). Yitzy,
// 2026-10-04: "we shouldn't scrap last years published videos. We dont want
// to kill those links."
//
// The key is the job lineage's script_id:
//   - plan-only and full-pipeline jobs carry script_id directly
//   - compose copies script_id from its reference job (compose-video.ts)
//   - clips-only / regen jobs leave it NULL and point at their parent via
//     regen_of_job_id, so walk up — the same walk modal_app.py does when it
//     resolves a regen job's script.

export interface JobForTeaching {
  id: string;
  script_id: string | null;
  regen_of_job_id: string | null;
}

// Same bound as modal_app.py's walk and clip-plan.ts: a cycle in the data
// can't spin forever, and no real lineage is anywhere near this deep.
const MAX_DEPTH = 10;

/**
 * The script id this job's lineage was built from, or null when it can't be
 * determined — no script anywhere up the chain, or the chain leaves `jobs`.
 */
export function teachingOf(
  jobs: ReadonlyArray<JobForTeaching>,
  jobId: string,
): string | null {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  let current = byId.get(jobId);
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    if (current.script_id) return current.script_id;
    if (!current.regen_of_job_id) return null;
    current = byId.get(current.regen_of_job_id);
  }
  return null;
}

/**
 * Ids of every job in `jobs` that belongs to the same teaching as `jobId`,
 * including `jobId` itself.
 *
 * An UNKNOWN teaching matches nothing — not even other unknowns. Two jobs
 * that both fail to resolve are not evidence of the same teaching, and the
 * cost of guessing wrong is unpublishing a video someone has linked to. When
 * in doubt, leave it published: an extra earlier teaching on the page is
 * harmless and one click to unpublish; a dead link isn't recoverable.
 */
export function sameTeachingJobIds(
  jobs: ReadonlyArray<JobForTeaching>,
  jobId: string,
): string[] {
  const teaching = teachingOf(jobs, jobId);
  if (!teaching) return [];
  return jobs.filter((j) => teachingOf(jobs, j.id) === teaching).map((j) => j.id);
}
