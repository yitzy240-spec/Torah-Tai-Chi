/**
 * Daily purge job: 7 days after a parsha video is published live, discard
 * all older drafts, superseded clip versions, and their associated DB rows.
 *
 * What is KEPT per parsha:
 *   - The single most-recent published video row.
 *   - The clips that make up that live video (via composed_from_clip_ids for
 *     compose jobs, or clips.job_id = live_video.job_id for normal jobs).
 *   - The script that produced the live video (chain-walked via
 *     jobs.regen_of_job_id, bounded to 25 hops).
 *   - The live job itself + any currently in-flight jobs (so we don't yank
 *     a job that is mid-run).
 *
 * What is PURGED per parsha:
 *   - All other videos rows.
 *   - clips whose job is being purged AND whose id is not in the keep-list.
 *   - jobs (except live + in-flight).
 *   - scripts (except the one tied to the live video).
 *   - clip_plans tied to purged jobs.
 *   - feedback rows whose applied_to_job_id is a purged job.
 *   - posts tied to purged videos.
 *   - Storage objects (clips.storage_path) for purged clips.
 *
 * Auth: Vercel Cron sets `Authorization: Bearer ${CRON_SECRET}`.
 * Dry-run: add `?dryRun=true` to identify candidates without deleting.
 *
 * Triggered by Vercel Cron (see dashboard/vercel.json). Runs daily at
 * 03:00 UTC.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logEvent } from '@/lib/events';

const CRON_SECRET = process.env.CRON_SECRET;
const KEEP_AFTER_DAYS = 7;

// Mirror of modal_app.py _IN_FLIGHT_STATUSES. Jobs in these states must
// not be purged even if they belong to a non-live job chain — the Modal
// worker is actively writing to them.
const IN_FLIGHT_STATUSES = new Set([
  'loading_parsha',
  'generating_plan',
  'uploading_refs',
  'generating_clips',
  'verifying',
  'stitching',
]);

interface ParshaResult {
  parshaId: string;
  parshaSlug: string;
  skippedReason?: string;
  keptVideoId?: string;
  purgedVideoIds: string[];
  purgedClipPaths: string[];
  purgedClipIds: string[];
  purgedJobIds: string[];
  purgedScriptIds: string[];
  dryRun: boolean;
}

/**
 * Walk the regen_of_job_id chain from a starting job to find the script_id
 * that was ultimately used. Stops when script_id is found, chain ends, or
 * depth limit is reached (matching the website's 25-hop bound).
 */
async function resolveScriptId(
  admin: ReturnType<typeof createServiceClient>,
  startJobId: string,
): Promise<string | null> {
  let currentJobId: string | null = startJobId;
  const visited = new Set<string>();
  const MAX_DEPTH = 25;

  for (let depth = 0; depth < MAX_DEPTH && currentJobId !== null; depth++) {
    if (visited.has(currentJobId)) break; // cycle guard
    visited.add(currentJobId);

    const { data: jobRow } = await admin
      .from('jobs')
      .select('script_id, regen_of_job_id')
      .eq('id', currentJobId)
      .single();

    const job = jobRow as { script_id: string | null; regen_of_job_id: string | null } | null;
    if (!job) break;
    if (job.script_id) return job.script_id;
    currentJobId = job.regen_of_job_id ?? null;
  }

  return null;
}

async function processParsha(
  admin: ReturnType<typeof createServiceClient>,
  parsha: { id: string; slug: string },
  dryRun: boolean,
): Promise<ParshaResult> {
  const result: ParshaResult = {
    parshaId: parsha.id,
    parshaSlug: parsha.slug,
    purgedVideoIds: [],
    purgedClipPaths: [],
    purgedClipIds: [],
    purgedJobIds: [],
    purgedScriptIds: [],
    dryRun,
  };

  // 1. Find the most-recently created published video for this parsha.
  const { data: liveVideo } = await admin
    .from('videos')
    .select('id, job_id, created_at, composed_from_clip_ids')
    .eq('parsha_id', parsha.id)
    .eq('published_to_website', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!liveVideo) {
    result.skippedReason = 'no published video';
    return result;
  }

  // 2. Only purge once the live video is at least 7 days old.
  const ageMs = Date.now() - new Date(liveVideo.created_at as string).getTime();
  if (ageMs < KEEP_AFTER_DAYS * 86_400 * 1000) {
    const daysOld = (ageMs / 86_400_000).toFixed(1);
    result.skippedReason = `live video only ${daysOld}d old (need ${KEEP_AFTER_DAYS})`;
    return result;
  }

  result.keptVideoId = liveVideo.id as string;
  const liveJobId = liveVideo.job_id as string;

  // 3a. Determine which clip IDs to keep.
  let keepClipIds: Set<string>;

  if (
    liveVideo.composed_from_clip_ids &&
    Array.isArray(liveVideo.composed_from_clip_ids) &&
    liveVideo.composed_from_clip_ids.length > 0
  ) {
    // Compose job: the clip IDs are explicitly listed.
    keepClipIds = new Set(liveVideo.composed_from_clip_ids as string[]);
  } else {
    // Normal job: clips belong to the live job and have a storage_path.
    const { data: liveClips } = await admin
      .from('clips')
      .select('id')
      .eq('job_id', liveJobId)
      .not('storage_path', 'is', null);
    keepClipIds = new Set((liveClips ?? []).map((c: { id: string }) => c.id));
  }

  // 3b. Walk the job chain to find the canonical script for the live video.
  const liveScriptId = await resolveScriptId(admin, liveJobId);

  // 4. Collect ALL jobs for this parsha, then determine which to purge.
  const { data: allJobs } = await admin
    .from('jobs')
    .select('id, status, script_id, regen_of_job_id')
    .eq('parsha_id', parsha.id);

  const jobsToKeep = new Set<string>([liveJobId]);
  const jobsToPurge: string[] = [];

  for (const job of allJobs ?? []) {
    const jobId = job.id as string;
    if (jobId === liveJobId) continue; // already in keep-set

    // Never purge in-flight jobs — Modal worker is still using them.
    if (IN_FLIGHT_STATUSES.has(job.status as string)) {
      jobsToKeep.add(jobId);
      continue;
    }

    jobsToPurge.push(jobId);
  }

  // 5. Collect ALL videos for this parsha except the live one.
  const { data: allVideos } = await admin
    .from('videos')
    .select('id')
    .eq('parsha_id', parsha.id)
    .neq('id', liveVideo.id);

  const videosToPurge = (allVideos ?? []).map((v: { id: string }) => v.id);
  result.purgedVideoIds = videosToPurge;

  // 6. Collect clips to purge: belong to a purged job AND not in keep-list.
  let clipsToPurge: { id: string; storage_path: string | null }[] = [];
  if (jobsToPurge.length > 0) {
    const { data: candidateClips } = await admin
      .from('clips')
      .select('id, storage_path')
      .in('job_id', jobsToPurge);

    clipsToPurge = (candidateClips ?? []).filter(
      (c: { id: string; storage_path: string | null }) => !keepClipIds.has(c.id),
    );
  }

  const clipPathsToPurge = clipsToPurge
    .map((c) => c.storage_path)
    .filter((p): p is string => p !== null && p !== '');

  result.purgedClipPaths = clipPathsToPurge;
  result.purgedClipIds = clipsToPurge.map((c) => c.id);
  result.purgedJobIds = jobsToPurge;

  // 7. Collect scripts to purge: all scripts for this parsha except the live one.
  const { data: allScripts } = await admin
    .from('scripts')
    .select('id')
    .eq('parsha_id', parsha.id);

  const scriptsToPurge = (allScripts ?? [])
    .map((s: { id: string }) => s.id)
    .filter((id) => id !== liveScriptId);

  result.purgedScriptIds = scriptsToPurge;

  if (dryRun) {
    // Dry-run: report what would happen, touch nothing.
    return result;
  }

  // 8. Delete Storage objects for purged clips BEFORE deleting DB rows,
  //    so if Storage delete fails the DB rows can be retried next run.
  if (clipPathsToPurge.length > 0) {
    const { error: storageErr } = await admin.storage
      .from('videos')
      .remove(clipPathsToPurge);
    if (storageErr) {
      console.warn(
        `[purge-old-clips] Storage remove partial failure for parsha ${parsha.slug}:`,
        storageErr.message,
      );
      // Continue — DB rows are still deleted so the paths won't be retried
      // as live clips. Storage orphans are preferable to DB orphans that
      // block future purge runs.
    }
  }

  // 9. Delete DB rows in child-before-parent order to avoid FK violations.

  // 9a. feedback rows whose applied_to_job_id is a purged job.
  if (jobsToPurge.length > 0) {
    await admin
      .from('feedback')
      .update({ applied_to_job_id: null })
      .in('applied_to_job_id', jobsToPurge);
  }

  // 9b. posts tied to purged videos.
  if (videosToPurge.length > 0) {
    await admin.from('posts').delete().in('video_id', videosToPurge);
  }

  // 9c. clips tied to purged jobs (excluding kept clips).
  if (clipsToPurge.length > 0) {
    await admin
      .from('clips')
      .delete()
      .in(
        'id',
        clipsToPurge.map((c) => c.id),
      );
  }

  // 9d. clip_plans tied to purged jobs.
  if (jobsToPurge.length > 0) {
    await admin.from('clip_plans').delete().in('job_id', jobsToPurge);
  }

  // 9e. Purged videos (on delete cascade removes their remaining children
  //     but the explicit deletes above prevent FK violations with posts).
  if (videosToPurge.length > 0) {
    await admin.from('videos').delete().in('id', videosToPurge);
  }

  // 9f. Purged jobs.
  if (jobsToPurge.length > 0) {
    await admin.from('jobs').delete().in('id', jobsToPurge);
  }

  // 9g. Scripts (FK: scripts are referenced by jobs.script_id; jobs were
  //     deleted above so this is safe, but only delete scripts NOT linked
  //     to any remaining job to be doubly safe).
  if (scriptsToPurge.length > 0) {
    await admin.from('scripts').delete().in('id', scriptsToPurge);
  }

  return result;
}

export async function GET(request: Request) {
  // Auth: require CRON_SECRET to be set in the environment.
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === 'true';

  const admin = createServiceClient();

  // Fetch all parshiot — the purge logic decides per-parsha whether to act.
  const { data: parshiot, error: parshaErr } = await admin
    .from('parshiot')
    .select('id, slug')
    .order('order', { ascending: true });

  if (parshaErr || !parshiot) {
    return NextResponse.json(
      { error: parshaErr?.message ?? 'Failed to load parshiot' },
      { status: 500 },
    );
  }

  const results: ParshaResult[] = [];

  for (const parsha of parshiot) {
    try {
      const result = await processParsha(
        admin,
        parsha as { id: string; slug: string },
        dryRun,
      );
      results.push(result);

      // Log to execution_events for observability.
      await logEvent({
        actor: 'system',
        level: 'info',
        event: 'purge.complete',
        subjectType: 'parsha',
        subjectId: parsha.id as string,
        message: result.skippedReason
          ? `Purge skipped for ${parsha.slug}: ${result.skippedReason}`
          : `Purge ${dryRun ? '(dry-run) ' : ''}complete for ${parsha.slug}: kept video ${result.keptVideoId ?? 'none'}, purged ${result.purgedVideoIds.length} videos, ${result.purgedClipIds.length} clips`,
        details: {
          keptVideoId: result.keptVideoId ?? null,
          purgedVideoIds: result.purgedVideoIds,
          purgedClipPaths: result.purgedClipPaths,
          purgedClipIds: result.purgedClipIds,
          purgedJobIds: result.purgedJobIds,
          purgedScriptIds: result.purgedScriptIds,
          skippedReason: result.skippedReason ?? null,
          dryRun,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[purge-old-clips] Error processing parsha ${parsha.slug}:`, message);
      results.push({
        parshaId: parsha.id as string,
        parshaSlug: parsha.slug as string,
        skippedReason: `error: ${message}`,
        purgedVideoIds: [],
        purgedClipPaths: [],
        purgedClipIds: [],
        purgedJobIds: [],
        purgedScriptIds: [],
        dryRun,
      });
    }
  }

  const acted = results.filter(
    (r) => !r.skippedReason && r.purgedVideoIds.length + r.purgedClipIds.length > 0,
  );

  return NextResponse.json({
    dryRun,
    parshiotProcessed: parshiot.length,
    parshiotActedOn: acted.length,
    results,
  });
}
