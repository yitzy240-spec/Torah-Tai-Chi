// dashboard/src/lib/clip-job-conflict.ts
//
// triggerClips refuses to queue a clips-only job while another one is still
// running for the same plan and an overlapping clip index — the same
// double-spend guard regenClipFromText has. Kept pure so it runs under
// node:test. clip_indexes null means "all clips" on both sides.

export type InFlightClipJob = { id: string; clip_indexes: number[] | null };

/** True when the requested render would overlap a job still in flight. */
export function clipIndexesOverlap(
  requested: number[] | null,
  inFlight: number[] | null,
): boolean {
  if (requested === null || inFlight === null) return true;
  const set = new Set(inFlight);
  return requested.some((i) => set.has(i));
}

/** First in-flight job that conflicts with the request, or null. */
export function findConflictingClipJob(
  requested: number[] | null,
  inFlightJobs: InFlightClipJob[],
): InFlightClipJob | null {
  return inFlightJobs.find((j) => clipIndexesOverlap(requested, j.clip_indexes ?? null)) ?? null;
}

/** Friendly message for the UI toast. requested is 0-based. */
export function clipJobConflictMessage(requested: number[] | null): string {
  if (requested !== null && requested.length === 1) {
    return `Clip ${requested[0] + 1} is already rendering. Wait for it to finish before starting another.`;
  }
  return 'These clips are already rendering. Wait for them to finish before starting another.';
}
