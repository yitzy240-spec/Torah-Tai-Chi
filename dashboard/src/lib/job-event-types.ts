// dashboard/src/lib/job-event-types.ts
//
// The shape of every event Modal publishes. Single source of truth:
// Modal serializes to this shape (via src/job_events.py), dashboard
// parses to this shape (via useJobStream). Adding a new stage = one
// edit here + producer + consumer all guided by the type.

export type JobStage =
  | 'queued'
  | 'plan_generating'
  | 'plan_ready'
  | 'clips_generating'
  | 'clip_done'
  | 'clip_failed'
  | 'stitching'
  | 'uploading'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface JobEvent {
  jobId: string;
  stage: JobStage;
  /** 1-indexed when stage is per-clip */
  clipIndex?: number;
  totalClips?: number;
  /** Storage path of the rendered mp4 (set when stage is 'done') */
  videoPath?: string;
  /** Operator-facing message (e.g. error detail) */
  message?: string;
  /** Wall-clock timestamp set by the publisher */
  ts?: string;
}

export const TERMINAL_STAGES: ReadonlySet<JobStage> = new Set([
  'done',
  'failed',
  'cancelled',
]);

export function isTerminalStage(s: JobStage | string | null | undefined): boolean {
  return typeof s === 'string' && TERMINAL_STAGES.has(s as JobStage);
}

export function broadcastChannel(jobId: string): string {
  return `job:${jobId}`;
}

export const BROADCAST_EVENT_NAME = 'progress';
