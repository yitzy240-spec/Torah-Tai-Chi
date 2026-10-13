// dashboard/src/lib/purge-plan.ts
//
// Which jobs / videos / scripts the nightly purge cron
// (app/api/cron/purge-old-clips) may delete for one parsha. Kept pure so
// the keep rules are unit-tested; the route only fetches rows and deletes.

import { isTerminal } from './job-status.ts';

export interface PurgeJob {
  id: string;
  status: string | null;
  script_id: string | null;
  regen_of_job_id: string | null;
}

export interface PurgeVideo {
  id: string;
  job_id: string | null;
}

export interface PurgeInput {
  liveJobId: string;
  liveVideoId: string;
  liveScriptId: string | null;
  allJobs: PurgeJob[];
  allVideos: PurgeVideo[];
  allScriptIds: string[];
  /** jobs.id of every clip on the keep-list (clips.job_id). */
  keptClipOwnerJobIds: Iterable<string>;
}

export interface PurgePlan {
  jobsToKeep: Set<string>;
  jobsToPurge: string[];
  videosToPurge: string[];
  scriptsToPurge: string[];
}

export function planPurge(input: PurgeInput): PurgePlan {
  const jobsToKeep = new Set<string>([input.liveJobId, ...input.keptClipOwnerJobIds]);
  const byId = new Map(input.allJobs.map((j) => [j.id, j]));
  for (const job of input.allJobs) {
    // Only a FINISHED job may go. queued (dispatched, worker not started
    // yet) and every in-flight status stay: deleting them yanks the row
    // out from under the Modal worker. So do their regen_of_job_id
    // ancestors: a clips-only / regen worker reads its parent's clip_plan
    // and clips (jobs.clip_plan_id is ON DELETE SET NULL, so purging the
    // parent would silently take the plan away mid-run).
    if (isTerminal(job.status)) continue;
    const seen = new Set<string>();
    for (let cur: PurgeJob | undefined = job; cur && !seen.has(cur.id);
      cur = cur.regen_of_job_id ? byId.get(cur.regen_of_job_id) : undefined) {
      seen.add(cur.id);
      jobsToKeep.add(cur.id);
    }
  }
  const jobsToPurge = input.allJobs.filter((j) => !jobsToKeep.has(j.id)).map((j) => j.id);

  // videos.job_id is ON DELETE CASCADE and a kept job may still be
  // rendering into its row, so a kept job's video stays too.
  const videosToPurge = input.allVideos
    .filter((v) => v.id !== input.liveVideoId && !(v.job_id && jobsToKeep.has(v.job_id)))
    .map((v) => v.id);

  // jobs.script_id has no ON DELETE rule: deleting a script a kept job
  // still references fails the whole batch.
  const keptScripts = new Set(
    input.allJobs
      .filter((j) => jobsToKeep.has(j.id) && j.script_id)
      .map((j) => j.script_id as string),
  );
  const scriptsToPurge = input.allScriptIds.filter(
    (id) => id !== input.liveScriptId && !keptScripts.has(id),
  );

  return { jobsToKeep, jobsToPurge, videosToPurge, scriptsToPurge };
}
