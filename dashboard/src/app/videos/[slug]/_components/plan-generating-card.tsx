// dashboard/src/app/videos/[slug]/_components/plan-generating-card.tsx
//
// In-progress card shown when a plan-only job is queued / generating_plan
// but the clip_plan row doesn't exist yet. Per spec: while Modal is
// generating the plan, the operator should see life (spinner, elapsed
// time, status) — not a silent "check back in a moment".
//
// The card subscribes to Supabase Broadcast via useJobStream so the page
// updates when the stage flips to 'done' (plan exists → router refresh →
// Phase 2 editor renders). Broadcast replaces the postgres_changes
// subscription on the jobs table to avoid WAL decode overhead.

'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJobStream } from '@/hooks/use-job-stream';
import { kickPlanOnly } from '@/app/actions/video-page/kick-plan-only';
import { cancelJob } from '@/app/actions/cancel-job';

interface Props {
  jobId: string;
  startedAt: string;
  parshaSlug: string;
}

export function PlanGeneratingCard({ jobId, startedAt, parshaSlug }: Props) {
  const router = useRouter();
  const event = useJobStream(jobId);
  const stage = event?.stage ?? 'queued';
  const message = event?.message ?? null;

  // When the job flips to any terminal state, refresh so the server can
  // pick up the new shape:
  //  - done    → clip_plan exists, Phase 2 editor renders
  //  - failed  → failure card replaces this spinner
  //  - cancelled → empty/restart card replaces this spinner
  // Without the 'cancelled' branch, this spinner stuck forever after a
  // Cancel click — same bug class as MEMORY feedback_realtime_listeners.
  useEffect(() => {
    if (stage === 'done' || stage === 'cancelled') {
      router.refresh();
    }
  }, [stage, router]);

  // Poll backstop: Broadcast is fire-and-forget with no replay, so a dropped
  // 'done' would leave this spinner up until the 3-min escape hatch (and then
  // Retry re-generates a plan that already exists). While generation is still
  // in flight, refresh the server view every 25s — when the plan lands, the
  // server re-render swaps this card for the Phase 2 editor on its own. Same
  // backstop pattern as phase-4-stitched.
  const terminal = stage === 'done' || stage === 'failed' || stage === 'cancelled';
  useEffect(() => {
    if (terminal) return;
    const id = setInterval(() => router.refresh(), 25_000);
    return () => clearInterval(id);
  }, [terminal, router]);

  // Kick Modal once on mount. The parent component only renders this card
  // when the job IS queued, so no need to re-check status before kicking.
  // kickedRef prevents double-firing on React strict-mode double-mount.
  const kickedRef = useRef(false);
  useEffect(() => {
    if (kickedRef.current) return;
    kickedRef.current = true;
    void kickPlanOnly(jobId);
  }, [jobId]);

  // Live elapsed-time tick.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSec = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const elapsedLabel = minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, '0')}s`
    : `${seconds}s`;

  const isFailed = stage === 'failed';
  const isCancelled = stage === 'cancelled';

  // Escape hatch: after 3 minutes a single (non-duplicate) job can still be
  // genuinely stuck — a silently-dropped Modal dispatch, say — and today the
  // operator had no way out but to wait. Offer Retry (re-dispatch Modal) and
  // Start over (cancel + back to Phase 1).
  const showEscapeHatch = !isFailed && !isCancelled && elapsedSec >= 180;
  const [retrying, setRetrying] = useState(false);
  const [startingOver, setStartingOver] = useState(false);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      // Re-dispatch Modal. Keep the spinner and keep watching — the
      // stage === 'done' effect will refresh the page when the plan lands.
      await kickPlanOnly(jobId);
    } finally {
      setRetrying(false);
    }
  };

  const handleStartOver = async () => {
    if (startingOver) return;
    setStartingOver(true);
    const res = await cancelJob(jobId);
    if (res.error) {
      setStartingOver(false);
      return;
    }
    router.push(`/videos/${parshaSlug}?phase=1`);
    router.refresh();
  };

  // Failed jobs are already terminal (nothing to cancel) — just route back to
  // the script so the operator can regenerate. Without this the failed card
  // was a dead-end with no button (and the watchdog now produces failed states
  // for stranded jobs, so this is the recovery path for those too).
  const handleBackToScript = () => {
    router.push(`/videos/${parshaSlug}?phase=1`);
    router.refresh();
  };

  // Rotating progress copy — Modal writes job.status_message asynchronously
  // and we don't always get fine-grained updates from Claude, so cycle
  // through honest stage descriptions on a timer to give the operator a
  // sense of forward motion. Each stage lasts ~12s; the last one sticks.
  const stages = [
    'Reading the script…',
    'Splitting into clip moments…',
    'Writing scene directions…',
    'Picking caption copy…',
    'Finalizing the plan…',
  ];
  const stageIndex = Math.min(Math.floor(elapsedSec / 12), stages.length - 1);

  const headline = isFailed
    ? 'Clip plan generation failed'
    : isCancelled
    ? 'Cancelled'
    : stages[stageIndex];
  const subline = isFailed
    ? (message ?? 'See the job log for details.')
    : isCancelled
    ? 'You cancelled this plan generation. Start a new one from Phase 1.'
    : 'Claude is reading your script and building a clip-by-clip plan. Usually 1–2 minutes.';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        minHeight: 240,
        background: 'var(--linen-50)',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        textAlign: 'center',
      }}
    >
      {!isFailed && !isCancelled && (
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '3px solid var(--ink-100)',
            borderTopColor: 'var(--navy-700)',
            animation: 'spin 0.9s linear infinite',
            marginBottom: 18,
          }}
        />
      )}
      {isFailed && (
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--tassel)',
            color: 'white',
            fontSize: 22,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
        >
          !
        </div>
      )}
      {isCancelled && (
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--ink-300)',
            color: 'white',
            fontSize: 22,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
        >
          ×
        </div>
      )}
      <div
        style={{
          fontFamily: 'var(--ff-display)',
          fontSize: 20,
          fontWeight: 500,
          color: 'var(--ink-900)',
          marginBottom: 8,
        }}
      >
        {headline}
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--ink-500)',
          maxWidth: 360,
          lineHeight: 1.5,
          marginBottom: 16,
        }}
      >
        {subline}
      </div>
      {!isFailed && !isCancelled && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-400)',
            fontFamily: 'var(--ff-body)',
          }}
        >
          {elapsedLabel} elapsed
          {elapsedSec > 90 && (
            <span style={{ color: 'var(--tassel)', marginLeft: 8 }}>
              · taking longer than usual
            </span>
          )}
        </div>
      )}
      {isFailed && (
        <button
          type="button"
          onClick={handleBackToScript}
          style={{
            minHeight: 44,
            marginTop: 4,
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'inherit',
            background: 'var(--navy-700)',
            color: 'var(--linen-50)',
            border: 'none',
            borderRadius: 8,
            padding: '10px 20px',
            cursor: 'pointer',
          }}
        >
          ← Back to script
        </button>
      )}
      {showEscapeHatch && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 20,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying || startingOver}
            style={{
              minHeight: 40,
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'inherit',
              background: 'var(--navy-700)',
              color: 'var(--linen-50)',
              border: 'none',
              borderRadius: 8,
              padding: '8px 18px',
              cursor: retrying ? 'wait' : 'pointer',
              opacity: retrying || startingOver ? 0.7 : 1,
            }}
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
          <button
            type="button"
            onClick={handleStartOver}
            disabled={retrying || startingOver}
            style={{
              minHeight: 40,
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'inherit',
              background: 'transparent',
              color: 'var(--ink-500)',
              border: '1px solid var(--ink-100)',
              borderRadius: 8,
              padding: '8px 18px',
              cursor: startingOver ? 'wait' : 'pointer',
              opacity: retrying || startingOver ? 0.7 : 1,
            }}
          >
            {startingOver ? 'Starting over…' : 'Start over'}
          </button>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
