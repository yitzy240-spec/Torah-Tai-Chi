// dashboard/src/lib/render-outcome.ts
//
// What happened to the last render of each clip — server-side, so the answer
// survives a page refresh.
//
// Yonah, 2026-10-04: "I clicked the re-render button, and it started and
// then stopped. Now it just says re-render. And when I refresh the page, it's
// still only says re-render. So how am I to know if I should click it again,
// or if something is still happening in the background?"
//
// A card has three honest states: RENDERING (a clips-only job for this index
// is still running — phase-2-data's initialPendingByIndex), DONE (a newer
// version chip), or FAILED. Failed used to exist only in client memory — a
// toast, and a banner that a refresh wiped — so after a refresh a failed
// render looked exactly like "never tried" and like "still running". This
// derives FAILED from the jobs table so the card can say so on every load.

export interface FailedRenderJob {
  id: string;
  /** NULL = the job targeted every clip ("Generate all"/"remaining"). */
  clipIndexes: number[] | null;
  triggeredAt: string;
  errorMessage: string | null;
}

export interface LastFailedRender {
  jobId: string;
  message: string;
  failedAt: string;
}

/**
 * Per clip index, the most recent failed render that nothing has superseded.
 *
 * A failure is superseded — and so not reported — when:
 *   - a render for that index is in flight now (the card shows a spinner), or
 *   - a version for that index landed AFTER the failed job was triggered
 *     (a later attempt succeeded).
 *
 * `failedJobs` may arrive in any order; the newest claim per index wins.
 */
export function lastFailedRenderByIndex(args: {
  failedJobs: readonly FailedRenderJob[];
  planIndexes: readonly number[];
  /** created_at of the newest rendered version per index. */
  newestVersionAtByIndex: ReadonlyMap<number, string>;
  pendingIndexes: ReadonlySet<number>;
}): Record<number, LastFailedRender> {
  const { failedJobs, planIndexes, newestVersionAtByIndex, pendingIndexes } = args;
  const newestFirst = [...failedJobs].sort((a, b) =>
    a.triggeredAt < b.triggeredAt ? 1 : a.triggeredAt > b.triggeredAt ? -1 : 0,
  );
  const out: Record<number, LastFailedRender> = {};
  for (const job of newestFirst) {
    const indexes = job.clipIndexes ?? planIndexes;
    for (const idx of indexes) {
      if (out[idx]) continue; // a newer failure already claimed this index
      if (pendingIndexes.has(idx)) continue;
      const versionAt = newestVersionAtByIndex.get(idx);
      if (versionAt && versionAt > job.triggeredAt) continue;
      out[idx] = {
        jobId: job.id,
        message: job.errorMessage?.trim() || 'The render stopped without an error message.',
        failedAt: job.triggeredAt,
      };
    }
  }
  return out;
}
