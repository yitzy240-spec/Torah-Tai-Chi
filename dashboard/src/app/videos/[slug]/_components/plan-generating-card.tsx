// dashboard/src/app/videos/[slug]/_components/plan-generating-card.tsx
//
// In-progress card shown when a plan-only job is queued / generating_plan
// but the clip_plan row doesn't exist yet. Per spec: while Modal is
// generating the plan, the operator should see life (spinner, elapsed
// time, status) — not a silent "check back in a moment".
//
// The card subscribes to the job row via Realtime so the page updates
// when status flips to 'done' (plan exists → router refresh → Phase 2
// editor renders).

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeRow } from '@/hooks/use-realtime-row';

interface JobRow {
  id: string;
  status: string;
  status_message: string | null;
  triggered_at: string;
}

interface Props {
  jobId: string;
  startedAt: string;
}

export function PlanGeneratingCard({ jobId, startedAt }: Props) {
  const router = useRouter();
  const job = useRealtimeRow<JobRow>('jobs', jobId, {
    id: jobId,
    status: 'queued',
    status_message: null,
    triggered_at: startedAt,
  });

  // When the job flips to 'done', the clip_plan row exists. Refresh the
  // page so the server re-fetches + the Phase 2 editor renders.
  useEffect(() => {
    if (job?.status === 'done') {
      router.refresh();
    }
  }, [job?.status, router]);

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

  const isFailed = job?.status === 'failed';

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
    : stages[stageIndex];
  const subline = isFailed
    ? (job?.status_message ?? 'See the job log for details.')
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
      {!isFailed && (
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
      {!isFailed && (
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
