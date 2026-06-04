// dashboard/src/lib/job-status.ts
//
// Single source of truth for `jobs.status` lifecycle constants. The
// dashboard kept rediscovering the same set across phase-2-plan-review,
// job-progress, plan-generating-card, phase-4-stitched, etc. — and
// missing the 'cancelled' branch in 3 of them silently caused the
// "spinner stuck after user clicked Cancel" bug class flagged in MEMORY
// (feedback_realtime_listeners_need_both_terminal_states.md).
//
// Add new statuses here, not inline. Every listener that branches on
// status should import from here so adding a new terminal state is a
// one-place change.

/**
 * Terminal states — the job has stopped running and won't change again
 * without an explicit operator action (retry, regen, etc.).
 *
 * - 'done': pipeline completed successfully
 * - 'failed': pipeline errored out
 * - 'cancelled': operator cancelled mid-flight via cancelJob()
 */
export const TERMINAL_JOB_STATUSES = new Set<string>(['done', 'failed', 'cancelled']);

/**
 * In-flight states — the job is making progress (or queued behind one
 * that is). UI should show a spinner / status pill.
 */
export const IN_FLIGHT_JOB_STATUSES = new Set<string>([
  'queued',
  'running',
  'generating_plan',
  'generating_clips',
  'stitching',
  'uploading',
]);

export function isTerminal(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && TERMINAL_JOB_STATUSES.has(status);
}

export function isInFlight(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && IN_FLIGHT_JOB_STATUSES.has(status);
}
