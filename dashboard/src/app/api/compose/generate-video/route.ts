import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/events';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compose/generate-video
 * Body: { topic: string }
 *
 * Creates a `jobs` row with kind='topic' + topic text, then fires the
 * Modal worker so the pipeline writes a Rav-Eli-voiced script, renders
 * clips, stitches the final, and drops it in Supabase Storage. Same
 * pipeline as parsha generation — only difference is the draft source.
 *
 * Returns: { jobId }
 *
 * GET /api/compose/generate-video?jobId=...
 * Polls the jobs+videos tables; returns one of:
 *   { state: 'pending', statusMessage?: string }
 *   { state: 'success', videoId, videoUrl, captions, thumbUrl? }
 *   { state: 'failed', error }
 */

type TierKey = `${Resolution} ${ModelTier}`;

const PARSED_DEFAULT: { resolution: Resolution; tier: ModelTier } = {
  resolution: '720p',
  tier: 'fast',
};

function parseTierKey(key: string | null | undefined): { resolution: Resolution; tier: ModelTier } {
  if (!key) return PARSED_DEFAULT;
  const parts = key.trim().split(/\s+/);
  if (parts.length !== 2) return PARSED_DEFAULT;
  const [res, tier] = parts as [Resolution, ModelTier];
  const validRes = ['480p', '720p', '1080p'].includes(res);
  const validTier = ['standard', 'fast'].includes(tier);
  if (!validRes || !validTier) return PARSED_DEFAULT;
  return { resolution: res, tier };
}

const SUCCESS_STATUS = 'done';
const FAILED_STATUS = 'failed';
const DIRECTOR_NOTES_MAX_CHARS = 1000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { topic?: string; moveSlug?: string | null; directorNotes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const topic = body.topic?.trim();
  if (!topic) return NextResponse.json({ error: 'topic is required' }, { status: 400 });
  if (topic.length > 2000) return NextResponse.json({ error: 'topic too long (max 2000 chars)' }, { status: 400 });

  let directorNotes: string | null = null;
  if (typeof body.directorNotes === 'string') {
    const trimmed = body.directorNotes.trim();
    if (trimmed.length > DIRECTOR_NOTES_MAX_CHARS) {
      return NextResponse.json(
        { error: `directorNotes too long (max ${DIRECTOR_NOTES_MAX_CHARS} chars)` },
        { status: 400 },
      );
    }
    directorNotes = trimmed === '' ? null : trimmed;
  }

  const moveSlugInput = body.moveSlug ?? null;
  let validatedMoveSlug: string | null = null;
  if (moveSlugInput !== null) {
    const { data: move } = await supabase
      .from('tai_chi_moves')
      .select('slug')
      .eq('slug', moveSlugInput)
      .maybeSingle();
    if (!move) {
      return NextResponse.json({ error: `Unknown move: ${moveSlugInput}` }, { status: 400 });
    }
    validatedMoveSlug = moveSlugInput;
  }

  // Read the site-wide default quality tier so topic videos match the
  // parsha pipeline's current quality setting.
  const { data: defaultTierRow } = await supabase
    .from('site_content')
    .select('value')
    .eq('key', 'settings.default_tier')
    .single();
  const rawTier = (defaultTierRow?.value as string | undefined) ?? '720p fast';
  const { resolution, tier: modelTier } = parseTierKey(rawTier as TierKey);

  const { data: job, error: insertErr } = await supabase
    .from('jobs')
    .insert({
      kind: 'topic',
      topic,
      status: 'queued',
      triggered_by: user.id,
      resolution,
      model_tier: modelTier,
      motion_ref_slug: validatedMoveSlug,
      director_notes: directorNotes,
    })
    .select('id').single();

  if (insertErr || !job) {
    const msg = insertErr?.message ?? 'Insert failed';
    await logEvent({
      actor: 'supabase',
      level: 'error',
      event: 'compose.video.job.insert.error',
      message: `Job insert failed: ${msg}`,
      details: { error: msg },
    });
    return NextResponse.json(
      { error: msg },
      { status: 500 },
    );
  }

  const workerUrl = process.env.MODAL_WORKER_URL;
  if (!workerUrl) {
    await supabase.from('jobs')
      .update({ status: FAILED_STATUS, error_message: 'MODAL_WORKER_URL not set' })
      .eq('id', job.id);
    await logEvent({
      actor: 'modal',
      level: 'error',
      event: 'compose.video.trigger.config.missing',
      subjectType: 'job',
      subjectId: job.id,
      message: 'MODAL_WORKER_URL not set — cannot dispatch pipeline',
    });
    return NextResponse.json({ error: 'MODAL_WORKER_URL not set' }, { status: 500 });
  }

  // Shared secret — Modal trigger() rejects requests without this header
  // to prevent unauthenticated callers from spawning paid Seedance runs.
  // Missing env is a transient config bug, not the job's fault: leave the
  // job in queued state so re-trigger Just Works after the env is fixed.
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!triggerSecret) {
    await logEvent({
      actor: 'modal',
      level: 'error',
      event: 'compose.video.trigger.config.missing',
      subjectType: 'job',
      subjectId: job.id,
      message: 'PIPELINE_TRIGGER_SECRET not set — cannot dispatch pipeline',
    });
    return NextResponse.json({ error: 'PIPELINE_TRIGGER_SECRET not set' }, { status: 503 });
  }

  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
      body: JSON.stringify({ job_id: job.id }),
      // The worker takes 10-30 minutes; we don't wait for the body,
      // just enough to confirm dispatch. 15s covers Modal cold-start
      // (~7s) plus the auth/idempotency SELECT.
      signal: AbortSignal.timeout(15000),
    });
    await logEvent({
      actor: 'modal',
      level: 'info',
      event: 'compose.video.trigger.ok',
      subjectType: 'job',
      subjectId: job.id,
      message: `Dispatched topic job ${job.id} to Modal`,
      details: { resolution, modelTier },
    });
  } catch (e) {
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase.from('jobs')
        .update({ status: FAILED_STATUS, error_message: String(e) })
        .eq('id', job.id);
      await logEvent({
        actor: 'modal',
        level: 'error',
        event: 'compose.video.trigger.error',
        subjectType: 'job',
        subjectId: job.id,
        message: `Modal dispatch failed: ${String(e)}`,
        details: { error: String(e), errorName: (e as Error).name },
      });
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  return NextResponse.json({ jobId: job.id });
}

/** Public URL for a Supabase Storage path in the `videos` bucket. */
function videoPublicUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/storage/v1/object/public/videos/${path.replace(/^\/+/, '')}`;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const { data: job, error } = await supabase
    .from('jobs')
    .select('id, status, status_message, error_message')
    .eq('id', jobId)
    .single();
  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'job not found' }, { status: 404 });
  }

  if (job.status === FAILED_STATUS) {
    return NextResponse.json({
      state: 'failed',
      error: job.error_message ?? 'Generation failed',
    });
  }

  if (job.status !== SUCCESS_STATUS) {
    return NextResponse.json({
      state: 'pending',
      statusMessage: job.status_message ?? job.status,
    });
  }

  // Status is 'done' — fetch the video row and the captions from the
  // clip_plan so the inline player + Post/Schedule can use them.
  const { data: video } = await supabase
    .from('videos')
    .select('id, mp4_path, thumb_path')
    .eq('job_id', jobId)
    .single();

  if (!video) {
    // Job marked done but video row not present yet — treat as pending.
    return NextResponse.json({ state: 'pending', statusMessage: 'finalizing' });
  }

  const { data: clipPlanRow } = await supabase
    .from('clip_plans')
    .select('plan_json')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // plan_json.captions follows PlatformCaptions — tiktok/instagram/
  // youtube_title/youtube_description/facebook/twitter. We shape it into
  // the Partial<Record<Platform, string>> the schedule-all sheet expects.
  const planJson = (clipPlanRow?.plan_json ?? {}) as {
    captions?: {
      tiktok?: string;
      instagram?: string;
      youtube_title?: string;
      youtube_description?: string;
      facebook?: string;
      twitter?: string;
    };
  };
  const src = planJson.captions ?? {};
  const captions: Record<string, string> = {};
  if (src.tiktok) captions.tiktok = src.tiktok;
  if (src.instagram) captions.instagram = src.instagram;
  if (src.facebook) captions.facebook = src.facebook;
  if (src.twitter) captions.twitter = src.twitter;
  if (src.youtube_title || src.youtube_description) {
    const title = src.youtube_title?.trim() ?? '';
    const desc = src.youtube_description?.trim() ?? '';
    // scheduleAll splits caption on first newline into title/description.
    captions.youtube = title && desc ? `${title}\n${desc}` : (title || desc);
  }

  return NextResponse.json({
    state: 'success',
    videoId: video.id,
    videoUrl: videoPublicUrl(video.mp4_path),
    thumbUrl: video.thumb_path ? videoPublicUrl(video.thumb_path) : null,
    captions,
  });
}
