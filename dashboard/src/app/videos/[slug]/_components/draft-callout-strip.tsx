// dashboard/src/app/videos/[slug]/_components/draft-callout-strip.tsx
//
// Blue strip shown above the live-status display when the page is in
// "live-and-draft" state and no continue query param is set.
//
// Per spec §3.2, tapping the strip lands on the MOST RECENT COMPLETED phase
// of the draft (not the next pending phase). Resolution rule:
//   Phase 4 if a stitched video exists
//   else Phase 3 if any clip is rendered
//   else Phase 2 if a clip_plans row exists
//   else Phase 1
//
// Navigation: /videos/<slug>?continue=1&phase=<n>
// page-new.tsx reads searchParams.continue + searchParams.phase to decide
// which draft phase to render.

'use client';
import Link from 'next/link';
import type { DraftPhase } from '@/lib/page-state';

export interface DraftCalloutStripProps {
  parshaSlug: string;
  /** The most-recent-completed phase resolved server-side per spec §3.2 */
  landingPhase: DraftPhase;
  /** Current draft phase (for the label) */
  phase: DraftPhase;
  clipsRendered: number;
  clipsTotal: number | null;
}

const PHASE_NAMES: Record<DraftPhase, string> = {
  1: 'Script',
  2: 'Plan',
  3: 'Clips',
  4: 'Stitched video',
  5: 'Post',
};

export function DraftCalloutStrip({
  parshaSlug,
  landingPhase,
  phase,
  clipsRendered,
  clipsTotal,
}: DraftCalloutStripProps) {
  const phaseSuffix =
    phase === 3 && clipsTotal !== null
      ? ` · ${clipsRendered}/${clipsTotal} clips`
      : '';

  return (
    <Link
      href={`/videos/${parshaSlug}?continue=1&phase=${landingPhase}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        background: '#f1f3f8',
        border: '1px solid #d4dae4',
        borderRadius: 10,
        textDecoration: 'none',
        color: 'var(--navy-700)',
        marginBottom: 16,
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--navy-700)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        ●
      </span>
      <div style={{ flex: 1, fontSize: 13 }}>
        <strong>Draft in progress</strong> · Phase {phase} of 5 ({PHASE_NAMES[phase]}
        {phaseSuffix})
      </div>
      <span style={{ fontSize: 12, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
        Continue draft →
      </span>
    </Link>
  );
}
