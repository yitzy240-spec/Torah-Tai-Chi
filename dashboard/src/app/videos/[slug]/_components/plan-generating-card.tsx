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

interface Props {
  jobId: string;
  startedAt: string;
}

export function PlanGeneratingCard({ jobId, startedAt }: Props) {
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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
