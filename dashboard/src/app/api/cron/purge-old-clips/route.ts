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
 *   - Storage objects (videos.mp4_path + thumb_path) for purged videos —
 *     added 2026-06-12 after 130 orphaned final.mp4s (1.2GB) were found.
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
import { sendNotification } from '@/lib/email';

const CRON_SECRET = process.env.CRON_SECRET;
const KEEP_AFTER_DAYS = 7;

// ── Orphan sweep config ────────────────────────────────────────────────
// Files under jobs/<id>/ whose job row no longer exists AND that no DB
// row references are garbage by definition — sweep them every run.
// Min age guards against racing a job whose row was deleted while Modal
// is still writing files. Warn email fires when usage is still above
// the threshold AFTER sweeping (real growth, not orphan accumulation).
const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const STORAGE_WARN_BYTES = Math.round(0.85 * 1024 ** 3); // 85% of the 1GB free tier

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
  purgedVideoPaths: string[];
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
    purgedVideoPaths: [],
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

  // 5. Collect ALL videos for this parsha except the live one — including
  //    their storage paths. mp4_path (the stitched final, ~10MB each) is
  //    the single largest artifact per draft; until 2026-06-12 the purge
  //    deleted these rows but never their files, orphaning 1.2GB+ of
  //    final.mp4s in the bucket.
  const { data: allVideos } = await admin
    .from('videos')
    .select('id, mp4_path, thumb_path')
    .eq('parsha_id', parsha.id)
    .neq('id', liveVideo.id);

  const videosToPurge = (allVideos ?? []).map((v: { id: string }) => v.id);
  result.purgedVideoIds = videosToPurge;

  const videoPathsToPurge = (allVideos ?? [])
    .flatMap((v: { mp4_path: string | null; thumb_path: string | null }) => [
      v.mp4_path,
      v.thumb_path,
    ])
    .filter((p): p is string => !!p);
  result.purgedVideoPaths = videoPathsToPurge;

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

  // 8. Delete Storage objects for purged clips AND purged videos'
  //    stitched finals/thumbs BEFORE deleting DB rows, so if Storage
  //    delete fails the DB rows can be retried next run.
  const allPathsToPurge = [...new Set([...clipPathsToPurge, ...videoPathsToPurge])];
  if (allPathsToPurge.length > 0) {
    const { error: storageErr } = await admin.storage
      .from('videos')
      .remove(allPathsToPurge);
    if (storageErr) {
      console.error(
        `[purge-old-clips] Storage remove FAILED for parsha ${parsha.slug} (${allPathsToPurge.length} paths) — these become permanent orphans:`,
        storageErr.message,
      );
      // Continue — DB rows are still deleted so the paths won't be retried
      // as live clips. Storage orphans are preferable to DB orphans that
      // block future purge runs. tools/purge-storage-orphans.mjs sweeps
      // any accumulated orphans.
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

type StorageFile = { path: string; size: number; createdAt: number };

/** Recursively list every object in the videos bucket (folders come back
 *  from storage.list with id === null). ~400 files at current scale. */
async function walkBucket(
  admin: ReturnType<typeof createServiceClient>,
  prefix = '',
): Promise<StorageFile[]> {
  const out: StorageFile[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage
      .from('videos')
      .list(prefix, { limit: 1000, offset });
    if (error || !data) break;
    for (const e of data) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) {
        out.push(...(await walkBucket(admin, p)));
      } else {
        out.push({
          path: p,
          size: (e.metadata as { size?: number } | null)?.size ?? 0,
          createdAt: new Date(e.created_at as string).getTime(),
        });
      }
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

interface SweepResult {
  totalBytesBeforeSweep: number;
  orphanCount: number;
  orphanBytes: number;
  removed: number;
  removedBytes: number;
  removeErrors: number;
}

/**
 * Comprehensive orphan sweep: delete jobs/ files that (a) belong to a
 * job id with no jobs row, (b) are referenced by NO database row
 * (videos.mp4_path/thumb_path, clips.storage_path, clip reference
 * images, tai_chi_moves files), and (c) are older than 24h. Published
 * content can never match: every published video is a videos row, so
 * its files are in the referenced set.
 *
 * Why this exists: until 2026-06-12 the purge deleted videos rows but
 * not their mp4_path/thumb_path files — 130 orphaned final.mp4s
 * (1.35GB) accumulated and blew the 1GB free tier. The per-parsha purge
 * now removes those paths going forward; this sweep self-heals any
 * orphans that slip through (e.g. swallowed storage-remove failures).
 */
async function sweepOrphans(
  admin: ReturnType<typeof createServiceClient>,
  dryRun: boolean,
): Promise<SweepResult> {
  const files = await walkBucket(admin);
  const totalBytesBeforeSweep = files.reduce((s, f) => s + f.size, 0);

  const referenced = new Set<string>();
  const { data: vids } = await admin.from('videos').select('mp4_path, thumb_path');
  for (const v of vids ?? []) {
    if (v.mp4_path) referenced.add(v.mp4_path as string);
    if (v.thumb_path) referenced.add(v.thumb_path as string);
  }
  const { data: clips } = await admin
    .from('clips')
    .select('storage_path, reference_image_paths');
  for (const c of clips ?? []) {
    if (c.storage_path) referenced.add(c.storage_path as string);
    for (const r of (c.reference_image_paths ?? []) as string[]) referenced.add(r);
  }
  const { data: moves } = await admin
    .from('tai_chi_moves')
    .select('mp4_storage_path, thumb_poster_path');
  for (const m of moves ?? []) {
    if (m.mp4_storage_path) referenced.add(m.mp4_storage_path as string);
    if (m.thumb_poster_path) referenced.add(m.thumb_poster_path as string);
  }
  const { data: jobs } = await admin.from('jobs').select('id');
  const jobIds = new Set((jobs ?? []).map((j: { id: string }) => j.id));

  const now = Date.now();
  const orphans = files.filter(
    (f) =>
      f.path.startsWith('jobs/') &&
      !jobIds.has(f.path.split('/')[1]) &&
      !referenced.has(f.path) &&
      now - f.createdAt > SWEEP_MIN_AGE_MS,
  );
  const orphanBytes = orphans.reduce((s, f) => s + f.size, 0);

  let removed = 0;
  let removedBytes = 0;
  let removeErrors = 0;
  if (!dryRun) {
    for (let i = 0; i < orphans.length; i += 100) {
      const batch = orphans.slice(i, i + 100);
      const { error } = await admin.storage
        .from('videos')
        .remove(batch.map((f) => f.path));
      if (error) {
        removeErrors += batch.length;
        console.error('[purge-old-clips] sweep remove failed:', error.message);
      } else {
        removed += batch.length;
        removedBytes += batch.reduce((s, f) => s + f.size, 0);
      }
    }
  }

  return {
    totalBytesBeforeSweep,
    orphanCount: orphans.length,
    orphanBytes,
    removed,
    removedBytes,
    removeErrors,
  };
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
          purgedVideoPaths: result.purgedVideoPaths,
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
        purgedVideoPaths: [],
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

  // ── Storage usage check + comprehensive orphan sweep ─────────────────
  let sweep: SweepResult | null = null;
  try {
    sweep = await sweepOrphans(admin, dryRun);
    const afterBytes = sweep.totalBytesBeforeSweep - sweep.removedBytes;
    const mb = (n: number) => (n / 1048576).toFixed(0);
    await logEvent({
      actor: 'system',
      level: 'info',
      event: 'purge.sweep',
      message: dryRun
        ? `Sweep (dry-run): ${sweep.orphanCount} orphan files (${mb(sweep.orphanBytes)}MB) of ${mb(sweep.totalBytesBeforeSweep)}MB total`
        : `Sweep: removed ${sweep.removed} orphan files (${mb(sweep.orphanBytes)}MB); bucket ${mb(sweep.totalBytesBeforeSweep)}MB → ~${mb(afterBytes)}MB`,
      details: { ...sweep, dryRun },
    });

    // Warn only when usage is high even after sweeping — that's real
    // content growth (or a sweep failure), not orphan accumulation.
    const effectiveBytes = dryRun
      ? sweep.totalBytesBeforeSweep - sweep.orphanBytes
      : afterBytes;
    if (effectiveBytes > STORAGE_WARN_BYTES || sweep.removeErrors > 0) {
      await sendNotification({
        subject: '[Torah Tai Chi] Supabase storage approaching limit',
        text:
          `Storage bucket is at ~${mb(effectiveBytes)}MB after the nightly orphan sweep ` +
          `(warn threshold ${mb(STORAGE_WARN_BYTES)}MB, free tier 1024MB). ` +
          (sweep.removeErrors > 0
            ? `${sweep.removeErrors} orphan files failed to delete. `
            : '') +
          `This is real kept content, not orphans — review what is stored or upgrade the plan.`,
        html: `<p>Storage bucket is at ~${mb(effectiveBytes)}MB after the nightly orphan sweep (warn threshold ${mb(STORAGE_WARN_BYTES)}MB, free tier 1024MB).</p>${sweep.removeErrors > 0 ? `<p><b>${sweep.removeErrors} orphan files failed to delete.</b></p>` : ''}<p>This is real kept content, not orphans — review what is stored or upgrade the plan.</p>`,
      });
    }
  } catch (err) {
    console.error('[purge-old-clips] sweep failed:', err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({
    dryRun,
    parshiotProcessed: parshiot.length,
    parshiotActedOn: acted.length,
    results,
    sweep,
  });
}
