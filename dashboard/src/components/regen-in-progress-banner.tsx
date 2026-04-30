'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

/**
 * Compact banner that surfaces an in-flight regen for the current parsha
 * directly on `/videos/<slug>`. Prevents the "lost the tab, no way back"
 * problem that the bare `/jobs/<id>` redirect creates after the user
 * submits feedback — the video page is now the persistent hub.
 *
 * Mirrors `JobProgress`'s realtime + 4s polling fallback pattern: realtime
 * lights up step transitions instantly when working, the poll covers cases
 * where the supabase_realtime publication / RLS chain is misconfigured.
 *
 * On a `done` transition we fire `router.refresh()` exactly once so the
 * server component re-runs and the freshly-stitched version takes the
 * canonical slot in the version selector. We don't redirect — the user
 * already sees the new video appear in place. On `failed`/`cancelled` we
 * keep the banner visible briefly so the user can click through to
 * `/jobs/<id>` for the Try-again flow.
 */

// Mirror JobProgress' STEPS so the pip row matches the verbose page exactly.
// Excludes 'done' since the banner unmounts on terminal transition.
const STEPS = [
  'queued',
  'loading_parsha',
  'generating_plan',
  'uploading_refs',
  'generating_clips',
  'verifying',
  'stitching',
] as const;

const STEP_LABELS: Record<string, string> = {
  queued: 'Queued',
  loading_parsha: 'Loading parsha',
  generating_plan: 'Writing the plan',
  uploading_refs: 'Uploading references',
  generating_clips: 'Generating clips',
  verifying: 'Verifying clips',
  stitching: 'Stitching',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

export interface InFlightJob {
  id: string;
  status: string;
  status_message: string | null;
  triggered_at: string | null;
  regen_of_job_id: string | null;
}

interface Props {
  initialJob: InFlightJob;
  /** p25–p75 of recent done jobs (mirrors JobProgress). Optional — if null
   *  we just show "Typical run: 10–14 min" as a coarse fallback so the
   *  banner still gives the user a rough wait expectation. */
  typicalRun?: { lowMin: number; highMin: number } | null;
}

export function RegenInProgressBanner({ initialJob, typicalRun }: Props) {
  const router = useRouter();
  const [job, setJob] = useState<InFlightJob>(initialJob);
  // Ref guard so router.refresh() fires exactly once on a `done` transition,
  // not in a loop if realtime + polling both deliver the same UPDATE.
  const refreshedOnDoneRef = useRef(false);

  // Realtime subscription on this single job row.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`regen-banner-${job.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${job.id}` },
        (payload) => setJob((j) => ({ ...j, ...(payload.new as Partial<InFlightJob>) })),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [job.id]);

  // 4s polling fallback. Stops once the status hits a terminal state.
  useEffect(() => {
    if (TERMINAL_STATUSES.has(job.status)) return;
    const supabase = createClient();
    const tick = async () => {
      const { data: latest } = await supabase
        .from('jobs')
        .select('id, status, status_message, triggered_at, regen_of_job_id')
        .eq('id', job.id)
        .single();
      if (latest) setJob((j) => ({ ...j, ...(latest as Partial<InFlightJob>) }));
    };
    const timer = setInterval(tick, 4000);
    return () => clearInterval(timer);
  }, [job.id, job.status]);

  // On `done`, refresh the server component so the new version appears in
  // place. We deliberately don't refresh on failed/cancelled — the user
  // benefits from staying on the existing version while they decide whether
  // to retry from /jobs/<id>.
  useEffect(() => {
    if (job.status === 'done' && !refreshedOnDoneRef.current) {
      refreshedOnDoneRef.current = true;
      router.refresh();
    }
  }, [job.status, router]);

  // Memoize the typical-run text BEFORE the early return so we don't
  // violate the rules of hooks when the banner unmounts on terminal status.
  const typicalText = useMemo(() => {
    if (!typicalRun) return '10\u201314 min';
    if (typicalRun.lowMin === typicalRun.highMin) return `~${typicalRun.lowMin} min`;
    return `${typicalRun.lowMin}\u2013${typicalRun.highMin} min`;
  }, [typicalRun]);

  // Once we've kicked off the refresh, don't render the banner anymore —
  // the page is about to swap in the new version. For failed/cancelled we
  // also stop rendering: the user can re-enter via /jobs/<id> if they
  // want the Try-again UI; keeping a stale "regenerating" banner around
  // would be misleading.
  if (TERMINAL_STATUSES.has(job.status)) return null;

  const stepIndex = Math.max(0, STEPS.findIndex((s) => s === job.status));
  const stepLabel = STEP_LABELS[job.status] ?? job.status;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '16px 20px',
        marginBottom: '24px',
        border: '1px solid var(--navy-700)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--navy-wash)',
        fontFamily: 'var(--ff-body)',
      }}
      className="regen-banner"
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
        className="regen-banner__row"
      >
        <Loader2
          className="regen-banner__spinner"
          style={{
            width: '18px',
            height: '18px',
            color: 'var(--navy-700)',
            flexShrink: 0,
            // Reuse the existing global keyframe so the banner spinner
            // matches every other spinner on the dashboard.
            animation: 'tt-spin 1s linear infinite',
          }}
        />
        <span
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--ink-900)',
            flex: '1 1 auto',
            minWidth: '200px',
          }}
        >
          Regenerating from feedback — {stepLabel}
        </span>
        <Link
          href={`/jobs/${job.id}`}
          style={{
            fontSize: '13px',
            color: 'var(--navy-700)',
            textDecoration: 'none',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          className="regen-banner__link"
        >
          View full progress →
        </Link>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          fontSize: '12px',
          color: 'var(--ink-500)',
        }}
      >
        {job.triggered_at && (
          <ElapsedText startedAt={job.triggered_at} typicalText={typicalText} />
        )}
        <StepPips currentIndex={stepIndex} />
      </div>

    </div>
  );
}

function ElapsedText({
  startedAt,
  typicalText,
}: {
  startedAt: string;
  typicalText: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedMs = Math.max(0, now - new Date(startedAt).getTime());
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      Started {formatDuration(elapsedMs)} ago
      <span style={{ color: 'var(--ink-300)' }}> · Typical run: {typicalText}</span>
    </span>
  );
}

/** Same shape as JobProgress' helper, duplicated to keep this component
 *  self-contained (the helper is six lines). */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function StepPips({ currentIndex }: { currentIndex: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        marginLeft: 'auto',
      }}
      aria-hidden
    >
      {STEPS.map((_, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <span
            key={i}
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: isCurrent
                ? 'var(--navy-700)'
                : isPast
                  ? 'var(--jade)'
                  : 'var(--ink-200)',
              animation: isCurrent ? 'pulse-navy 1.8s ease-in-out infinite' : undefined,
              flexShrink: 0,
            }}
          />
        );
      })}
    </span>
  );
}
