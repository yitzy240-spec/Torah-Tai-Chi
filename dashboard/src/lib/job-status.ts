// dashboard/src/lib/job-status.ts
//
// Single source of truth for the `jobs.status` terminal set, shared with
// the Modal workers (src/db_rows.py TERMINAL_JOB_STATUSES). Missing the
// 'cancelled' branch once caused the "spinner stuck after user clicked
// Cancel" bug class (feedback_realtime_listeners_need_both_terminal_states).

/**
 * Terminal states: the job has stopped running and won't change again
 * without an explicit operator action (retrigger-job.ts resets the row to
 * 'queued' first).
 *
 * - 'done': pipeline completed successfully
 * - 'failed': pipeline errored out
 * - 'cancelled': operator cancelled mid-flight via cancelJob()
 */
export const TERMINAL_JOB_STATUSES = ['done', 'failed', 'cancelled'] as const;

/**
 * PostgREST list literal for guarding a jobs UPDATE so it never moves a
 * finished job:
 *
 *   .update({ status: 'failed', ... }).eq('id', id)
 *   .not('status', 'in', TERMINAL_STATUS_LIST)
 */
export const TERMINAL_STATUS_LIST = `(${TERMINAL_JOB_STATUSES.join(',')})`;

export function isTerminal(status: string | null | undefined): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status ?? '');
}
