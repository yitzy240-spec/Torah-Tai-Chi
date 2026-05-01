import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { autoPost } from '@/lib/auto-post';
import { getStance } from '@/lib/stance';
import { logEvent } from '@/lib/events';
import { sendNotification } from '@/lib/email';
import type { Platform } from '@/lib/platforms';

const DASHBOARD_BASE_URL =
  process.env.DASHBOARD_BASE_URL ?? 'https://admin.torahtaichi.com';

/** Translate the autoPost error string into something Yonah can read.
 *  Falls back to the raw message if no friendly version is known. */
function autopilotSentenceFromError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('no captions')) return 'the AI plan was missing post captions';
  if (m.includes('buffer') && m.includes('token')) return 'the Buffer connection isn\'t set up';
  if (m.includes('youtube')) return 'YouTube wasn\'t reachable';
  return msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  const sb = createServiceClient();

  // Load the job. We need parsha_id to confirm this is a parsha job
  // and to find the A-tight script (for logging — captions come from
  // the clip_plan written during this run). regen_of_job_id tells us
  // whether this is a fresh first-generation or a user-driven regen
  // (which we never auto-post — see autopilotEligible below).
  const { data: job, error: jobErr } = await sb
    .from('jobs')
    .select('id, kind, parsha_id, regen_of_job_id, parshiot:parsha_id(name, slug)')
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
  // out weekly parsha videos. Stance gates apply only to parsha jobs.
  // Regens never auto-post: a regen means Yonah is correcting something
  // (a name, a visual, a clip swap), and the original video may already
  // be live. Re-fanning would create duplicate posts on every channel.
  // The user re-ships from the post-now sheet manually when ready.
  const isRegen = !!(job as { regen_of_job_id?: string | null }).regen_of_job_id;
  const autopilotEligible = (
    (job.kind === 'parsha' || !job.kind)
    && stance === 'auto'
    && !isRegen
  );
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
  } else if (isRegen) {
    await logEvent({
      actor: 'system',
      level: 'info',
      event: 'autopilot.skipped.regen',
      subjectType: 'video',
      subjectId: videoId,
      message: 'Autopilot skipped — this is a regen, not a first generation',
      details: { jobId, regenOfJobId: (job as { regen_of_job_id?: string | null }).regen_of_job_id },
    });
  } else if (stance !== 'auto') {
    await logEvent({
      actor: 'system',
      level: 'info',
      event: 'autopilot.skipped.stance',
      subjectType: 'video',
      subjectId: videoId,
      message: `Autopilot skipped — stance is '${stance}'`,
      details: { stance, jobId },
    });
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

  // Autopilot path: only runs if eligible AND there are captions to
  // post with. Otherwise we fall through to the success email so
  // Yonah at least knows the video is ready, even if scheduling
  // didn't fan out.
  const scheduledAt = nextFriday6pmLocal();
  let autopilotResult: Awaited<ReturnType<typeof autoPost>> | null = null;
  let autopilotErrorMsg: string | null = null;

  if (autopilotEligible && Object.keys(captions).length > 0) {
    try {
      const result = await autoPost({
        videoId,
        scheduledAt,
        captions,
        shareNow: false,
      });

      if (result.error) {
        autopilotErrorMsg = result.error;
        await logEvent({
          actor: 'system',
          level: 'error',
          event: 'autopilot.error',
          subjectType: 'video',
          subjectId: videoId,
          message: `Autopilot fanout failed: ${result.error}`,
          details: { jobId, error: result.error },
        });
      } else {
        autopilotResult = result;
      }
    } catch (autopilotErr) {
      autopilotErrorMsg = autopilotErr instanceof Error ? autopilotErr.message : String(autopilotErr);
      await logEvent({
        actor: 'system',
        level: 'error',
        event: 'autopilot.error',
        subjectType: 'video',
        subjectId: videoId,
        message: `Autopilot threw: ${autopilotErrorMsg}`,
        details: { jobId, error: autopilotErrorMsg },
      });
    }
  } else if (autopilotEligible && Object.keys(captions).length === 0) {
    autopilotErrorMsg = 'no captions on clip_plan';
    await logEvent({
      actor: 'system',
      level: 'error',
      event: 'autopilot.error',
      subjectType: 'video',
      subjectId: videoId,
      message: `Autopilot: no captions on clip_plan for job ${jobId}`,
      details: { jobId },
    });
  }

  // Email send happens regardless of autopilot outcome — the video IS
  // ready and Yonah needs to know. The email body adapts based on
  // whether autopilot ran, was skipped, or errored.

  try {
    const result = autopilotResult ?? { results: [] };

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

    // Operator notification — success. The Supabase typegen treats
    // the embedded foreign-table select as a possibly-null relation,
    // so we accept either an object or array shape here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parshaRel = (job as any)?.parshiot;
    const parsha = (Array.isArray(parshaRel) ? parshaRel[0] : parshaRel) ?? null;
    const parshaName: string = parsha?.name ?? 'Unknown';
    const parshaSlug: string | null = parsha?.slug ?? null;

    // Pull the per-clip Gemini verification state so the success
    // email can flag any clips that didn't pass after the bounded
    // retry. Failures here must not block the email — a missing
    // notes column or RLS denial just means we skip the addendum.
    let unverifiedAddendumHtml = '';
    let unverifiedAddendumText = '';
    try {
      const { data: clipVerifyRows } = await sb
        .from('clips')
        .select('index, verification_status, verification_attempts, verification_notes')
        .eq('job_id', jobId)
        .order('index');
      const failed = (clipVerifyRows ?? []).filter(
        (c: { verification_status?: string | null }) =>
          c.verification_status === 'failed',
      );
      if (failed.length > 0) {
        const lines = failed.map((c: {
          index: number;
          verification_attempts?: number | null;
          verification_notes?: unknown;
        }) => {
          // verification_notes is the raw Gemini structured response.
          // Pull failed claims out so the email reads as actionable
          // ("clip 3 — candles still appear on separate shelves")
          // rather than "clip 3 didn't verify".
          const notes = c.verification_notes as
            | { results?: Array<{ id?: string; pass?: boolean; evidence?: string }>;
                checks?: Array<{ id?: string; claim?: string }> }
            | null
            | undefined;
          const claimById = new Map<string, string>();
          for (const ch of notes?.checks ?? []) {
            if (ch?.id && ch.claim) claimById.set(ch.id, ch.claim);
          }
          const failedClaims: string[] = [];
          const seenIds = new Set<string>();
          for (const r of notes?.results ?? []) {
            if (!r?.id) continue;
            seenIds.add(r.id);
            if (r.pass !== true) {
              const claim = claimById.get(r.id) ?? r.id;
              failedClaims.push(claim);
            }
          }
          // Conservative: a check id with no result row is also a failure.
          for (const [id, claim] of claimById) {
            if (!seenIds.has(id)) failedClaims.push(claim);
          }
          const summary = failedClaims.length > 0
            ? failedClaims.slice(0, 2).join('; ')
            : 'verification failed (no specific claims recorded)';
          const attemptsLabel = c.verification_attempts
            ? ` after ${c.verification_attempts} attempt(s)`
            : '';
          return { index: c.index, summary, attemptsLabel };
        });
        const linesHtml = lines
          .map((l: { index: number; summary: string; attemptsLabel: string }) =>
            `<li><strong>Clip ${escapeHtml(String(l.index))}</strong>${escapeHtml(l.attemptsLabel)} — ${escapeHtml(l.summary)}</li>`,
          )
          .join('');
        const linesText = lines
          .map((l: { index: number; summary: string; attemptsLabel: string }) =>
            `  - Clip ${l.index}${l.attemptsLabel} — ${l.summary}`,
          )
          .join('\n');
        unverifiedAddendumHtml = `<p><strong>Heads up:</strong> ${failed.length} clip(s) didn&apos;t pass visual verification. You may want to review:</p><ul>${linesHtml}</ul>`;
        unverifiedAddendumText = `\nHeads up: ${failed.length} clip(s) didn't pass visual verification. You may want to review:\n${linesText}\n`;
      }
    } catch (verifyErr) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      console.warn(`[video-complete] failed to read clip verification state: ${msg}`);
    }

    try {
      const linkHtml = parshaSlug
        ? `<p>View it here: <a href="${DASHBOARD_BASE_URL}/videos/${escapeHtml(parshaSlug)}">${DASHBOARD_BASE_URL}/videos/${escapeHtml(parshaSlug)}</a></p>`
        : '<p>Your video is ready — check the dashboard.</p>';
      const linkText = parshaSlug
        ? `View it here: ${DASHBOARD_BASE_URL}/videos/${parshaSlug}`
        : 'Your video is ready — check the dashboard.';

      // Autopilot status sentence adapts to what actually happened.
      let autopilotSentenceHtml: string;
      let autopilotSentenceText: string;
      if (autopilotResult) {
        const n = (autopilotResult.results ?? []).length;
        autopilotSentenceHtml = `Autopilot has scheduled it across ${n} connected channel(s) for the upcoming Shabbat.`;
        autopilotSentenceText = autopilotSentenceHtml;
      } else if (autopilotErrorMsg) {
        autopilotSentenceHtml = `Autopilot didn&apos;t schedule it — ${escapeHtml(autopilotSentenceFromError(autopilotErrorMsg))}. You can review and schedule manually.`;
        autopilotSentenceText = `Autopilot didn't schedule it — ${autopilotSentenceFromError(autopilotErrorMsg)}. You can review and schedule manually.`;
      } else if (!autopilotEligible && job.kind && job.kind !== 'parsha') {
        autopilotSentenceHtml = 'This was a topic generation, so autopilot didn&apos;t fan out.';
        autopilotSentenceText = "This was a topic generation, so autopilot didn't fan out.";
      } else if (!autopilotEligible) {
        autopilotSentenceHtml = `Autopilot is currently set to <strong>${escapeHtml(stance)}</strong>, so this video wasn&apos;t auto-scheduled. Review it on the dashboard to publish.`;
        autopilotSentenceText = `Autopilot is currently set to '${stance}', so this video wasn't auto-scheduled. Review it on the dashboard to publish.`;
      } else {
        autopilotSentenceHtml = 'Autopilot didn&apos;t fan out this run.';
        autopilotSentenceText = "Autopilot didn't fan out this run.";
      }

      await sendNotification({
        subject: `\u2713 Video ready: ${parshaName}`,
        html: `<p>Hi,</p><p>The Torah Tai Chi pipeline finished generating <strong>${escapeHtml(parshaName)}</strong>. ${autopilotSentenceHtml}</p>${unverifiedAddendumHtml}${linkHtml}<p>— Torah Tai Chi pipeline</p>`,
        text: `The Torah Tai Chi pipeline finished generating ${parshaName}. ${autopilotSentenceText}\n${unverifiedAddendumText}\n${linkText}\n\n— Torah Tai Chi pipeline`,
      });
    } catch (emailErr) {
      // Resend outage must not fail the autopilot webhook — autopilot
      // already ran and committed Buffer/YouTube schedules.
      const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
      console.warn(`[video-complete] notification email threw: ${msg}`);
    }

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
