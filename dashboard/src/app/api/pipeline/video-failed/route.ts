import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { logEvent } from '@/lib/events';
import { sendNotification } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pipeline/video-failed
 *
 * Fired by the Modal pipeline when `run_pipeline` raises a terminal
 * exception. The failure status writeback to `jobs.status='failed'`
 * happens on the Modal side; this route is purely for operator
 * notification (email).
 *
 * Body: { jobId: string, errorMessage: string, stage: string }
 * Auth: shared `x-pipeline-secret` header, same secret as
 *       /api/pipeline/video-complete.
 */

const DASHBOARD_BASE_URL =
  process.env.DASHBOARD_BASE_URL ?? 'https://torah-tai-chi-admin.vercel.app';

interface Body {
  jobId?: string;
  errorMessage?: string;
  stage?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Constant-time string compare. Returns false on length mismatch
 *  (timingSafeEqual would throw) so callers don't have to guard. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  const expected = process.env.PIPELINE_WEBHOOK_SECRET;
  const got = request.headers.get('x-pipeline-secret');
  if (!expected || !got || !safeEqual(expected, got)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const jobId = body.jobId?.trim();
  const errorMessage = (body.errorMessage ?? '').toString();
  const stage = (body.stage ?? '').toString().trim() || 'unknown';
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  }

  const sb = createServiceClient();

  // Look up the job + its parsha so the email can name the parsha.
  // Topic jobs have no parsha_id and we still want to notify, so the
  // parsha name is best-effort.
  const { data: job, error: jobErr } = await sb
    .from('jobs')
    .select('id, kind, parsha_id, topic, parshiot:parsha_id(name, slug)')
    .eq('id', jobId)
    .maybeSingle();

  if (jobErr) {
    await logEvent({
      actor: 'system',
      level: 'error',
      event: 'pipeline.failed.notify_lookup_error',
      subjectType: 'job',
      subjectId: jobId,
      message: `Failure-notify: job lookup error: ${jobErr.message}`,
      details: { jobId, error: jobErr.message },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parshaRel = (job as any)?.parshiot;
  const parsha = (Array.isArray(parshaRel) ? parshaRel[0] : parshaRel) ?? null;
  const subjectName: string =
    parsha?.name ??
    ((job?.kind === 'topic' && job?.topic) ? `Topic: ${String(job.topic).slice(0, 60)}` : 'Unknown');

  // Truncate the error message so the email body stays readable.
  const truncatedError =
    errorMessage.length > 200 ? `${errorMessage.slice(0, 200)}\u2026` : errorMessage;

  const retryUrl = `${DASHBOARD_BASE_URL}/jobs/${jobId}`;
  const subject = `\u2717 Video failed: ${subjectName}`;
  const html = [
    `<p>Hi,</p>`,
    `<p>The Torah Tai Chi pipeline failed for <strong>${escapeHtml(subjectName)}</strong>.</p>`,
    `<p>Generation failed during <strong>${escapeHtml(stage)}</strong>.</p>`,
    truncatedError
      ? `<p><em>${escapeHtml(truncatedError)}</em></p>`
      : '',
    `<p>Click to retry: <a href="${retryUrl}">${retryUrl}</a></p>`,
    `<p>— Torah Tai Chi pipeline</p>`,
  ].join('');
  const text = [
    `The Torah Tai Chi pipeline failed for ${subjectName}.`,
    ``,
    `Generation failed during ${stage}.`,
    truncatedError ? `\n${truncatedError}\n` : '',
    `Click to retry: ${retryUrl}`,
    ``,
    `— Torah Tai Chi pipeline`,
  ].join('\n');

  const emailResult = await sendNotification({ subject, html, text });

  await logEvent({
    actor: 'system',
    level: 'info',
    event: 'pipeline.failed.notified',
    subjectType: 'job',
    subjectId: jobId,
    message:
      'ok' in emailResult
        ? `Failure email sent for ${subjectName} (stage=${stage})`
        : `Failure email NOT sent for ${subjectName}: ${emailResult.error}`,
    details: { jobId, stage, errorMessage: truncatedError, emailResult },
  });

  if ('error' in emailResult) {
    return NextResponse.json({ ok: false, error: emailResult.error }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
