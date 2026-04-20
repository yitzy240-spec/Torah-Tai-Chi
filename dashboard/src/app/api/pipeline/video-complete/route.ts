import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { autoPost } from '@/lib/auto-post';
import { getStance } from '@/lib/stance';
import { logEvent } from '@/lib/events';
import type { Platform } from '@/lib/platforms';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pipeline/video-complete
 *
 * Fired by the Modal pipeline at the end of a successful `parsha` job.
 * This is the autopilot entry point — if the site stance is 'auto',
 * the freshly-generated video is scheduled to every connected channel
 * for the upcoming Shabbat (Friday 18:00 local) without a human click.
 *
 * Trust boundary: the shared secret in `x-pipeline-secret`. There is
 * no session; everything uses the service client.
 */

interface Body {
  jobId?: string;
  videoId?: string;
}

/** Compute the next Friday at 18:00 in server-local time. If it's already
 *  Friday 18:00 or later, jump to next week so we never schedule in the past. */
function nextFriday6pmLocal(now: Date = new Date()): Date {
  const result = new Date(now);
  // Day 0 = Sunday, 5 = Friday
  const day = result.getDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  // Build the candidate Friday at 18:00 local
  const candidate = new Date(result);
  candidate.setDate(result.getDate() + daysUntilFriday);
  candidate.setHours(18, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    // Today is Friday and past 18:00 — push to next week.
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate;
}

/** Shape plan_json.captions (with youtube_title/youtube_description) into
 *  the Partial<Record<Platform,string>> autoPost expects. Mirrors the logic
 *  in /api/compose/generate-video GET so both paths behave identically. */
function shapeCaptions(planJson: unknown): Partial<Record<Platform, string>> {
  const src = ((planJson as { captions?: Record<string, string> })?.captions) ?? {};
  const captions: Partial<Record<Platform, string>> = {};
  if (src.tiktok) captions.tiktok = src.tiktok;
  if (src.instagram) captions.instagram = src.instagram;
  if (src.facebook) captions.facebook = src.facebook;
  if (src.twitter) captions.twitter = src.twitter;
  if (src.youtube_title || src.youtube_description) {
    const title = (src.youtube_title ?? '').trim();
    const desc = (src.youtube_description ?? '').trim();
    captions.youtube = title && desc ? `${title}\n${desc}` : (title || desc);
  }
  return captions;
}

export async function POST(request: Request) {
  // Secret header auth — single string compare, constant-time isn't
  // critical here but keep it in one place for clarity.
  const expected = process.env.PIPELINE_WEBHOOK_SECRET;
  const got = request.headers.get('x-pipeline-secret');
  if (!expected || !got || got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const jobId = body.jobId?.trim();
  const videoId = body.videoId?.trim();
  if (!jobId || !videoId) {
    return NextResponse.json({ error: 'jobId and videoId required' }, { status: 400 });
  }

  const stance = await getStance();
  if (stance !== 'auto') {
    await logEvent({
      actor: 'system',
      level: 'info',
      event: 'autopilot.skipped.stance',
      subjectType: 'video',
      subjectId: videoId,
      message: `Autopilot skipped — stance is '${stance}'`,
      details: { stance, jobId },
    });
    return NextResponse.json({ ok: true, skipped: 'stance' });
  }

  const sb = createServiceClient();

  // Load the job. We need parsha_id to confirm this is a parsha job
  // and to find the A-tight script (for logging — captions come from
  // the clip_plan written during this run).
  const { data: job, error: jobErr } = await sb
    .from('jobs')
    .select('id, kind, parsha_id')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) {
    await logEvent({
      actor: 'system',
      level: 'error',
      event: 'autopilot.error',
      subjectType: 'video',
      subjectId: videoId,
      message: `Autopilot: job ${jobId} not found`,
      details: { error: jobErr?.message ?? 'not found', jobId },
    });
    return NextResponse.json({ error: 'job not found' }, { status: 404 });
  }

  // Topic jobs come from Compose with their own UI; autopilot only fans
  // out weekly parsha videos.
  if (job.kind && job.kind !== 'parsha') {
    await logEvent({
      actor: 'system',
      level: 'info',
      event: 'autopilot.skipped.kind',
      subjectType: 'video',
      subjectId: videoId,
      message: `Autopilot skipped — job kind is '${job.kind}'`,
      details: { kind: job.kind, jobId },
    });
    return NextResponse.json({ ok: true, skipped: 'kind' });
  }

  // Pull the A-tight script for the parsha so we have it in the log
  // trail (the captions themselves live on the clip_plan).
  if (job.parsha_id) {
    await sb
      .from('scripts')
      .select('id, option')
      .eq('parsha_id', job.parsha_id)
      .eq('option', 'A-tight')
      .maybeSingle();
  }

  // Latest clip_plan for this job — its plan_json.captions is what
  // the pipeline wrote during this run.
  const { data: planRow } = await sb
    .from('clip_plans')
    .select('plan_json')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const captions = shapeCaptions(planRow?.plan_json);
  if (Object.keys(captions).length === 0) {
    await logEvent({
      actor: 'system',
      level: 'error',
      event: 'autopilot.error',
      subjectType: 'video',
      subjectId: videoId,
      message: `Autopilot: no captions on clip_plan for job ${jobId}`,
      details: { jobId },
    });
    return NextResponse.json({ error: 'no captions on clip_plan' }, { status: 422 });
  }

  const scheduledAt = nextFriday6pmLocal();

  try {
    const result = await autoPost({
      videoId,
      scheduledAt,
      captions,
      shareNow: false,
    });

    if (result.error) {
      await logEvent({
        actor: 'system',
        level: 'error',
        event: 'autopilot.error',
        subjectType: 'video',
        subjectId: videoId,
        message: `Autopilot fanout failed: ${result.error}`,
        details: { jobId, error: result.error },
      });
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const bufferIds = (result.results ?? [])
      .filter((r) => r.platform !== 'youtube')
      .map((r) => ({ platform: r.platform, id: r.externalId }));
    const youtubeId = (result.results ?? []).find((r) => r.platform === 'youtube')?.externalId ?? null;

    await logEvent({
      actor: 'system',
      level: 'action',
      event: 'autopilot.scheduled',
      subjectType: 'video',
      subjectId: videoId,
      message: `Autopilot scheduled video for ${scheduledAt.toISOString()} (${(result.results ?? []).length} channels)`,
      details: {
        jobId,
        scheduledAt: scheduledAt.toISOString(),
        bufferIds,
        youtubeId,
      },
    });

    return NextResponse.json({
      ok: true,
      scheduledAt: scheduledAt.toISOString(),
      results: result.results ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent({
      actor: 'system',
      level: 'error',
      event: 'autopilot.error',
      subjectType: 'video',
      subjectId: videoId,
      message: `Autopilot threw: ${msg}`,
      details: { jobId, error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
