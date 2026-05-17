// dashboard/src/app/videos/[slug]/_components/compressed-stepper.tsx
//
// Compressed mobile stepper. Shows "Phase X of 5: <name>" + a 5-segment
// progress bar. Tap "steps" to expand to a full list with all phase names.
// Per spec §4. Segment colors: jade (done), navy-700 (current), ink-200 (pending).

'use client';
import { useState } from 'react';

const PHASE_NAMES = ['Script', 'Plan', 'Clips', 'Stitched video', 'Post'] as const;

interface Props {
  currentPhase: 1 | 2 | 3 | 4 | 5;
}

export function CompressedStepper({ currentPhase }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: 'var(--linen-50)',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-md)',
        padding: '10px 14px',
        marginBottom: 16,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'var(--ink-900)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          minHeight: 44, // 44pt hit target
        }}
      >
        <span style={{ color: 'var(--navy-700)' }}>
          Phase {currentPhase} of 5 · {PHASE_NAMES[currentPhase - 1]}
        </span>
        <span style={{ color: 'var(--ink-500)', fontSize: 12 }}>
          {expanded ? '▴ steps' : '▾ steps'}
        </span>
      </button>

      {/* 5-segment progress bar */}
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        {([1, 2, 3, 4, 5] as const).map((p) => (
          <div
            key={p}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background:
                p < currentPhase
                  ? 'var(--jade)'
                  : p === currentPhase
                  ? 'var(--navy-700)'
                  : 'var(--ink-200)',
            }}
          />
        ))}
      </div>

      {/* Expandable step list */}
      {expanded && (
        <ol style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', fontSize: 12 }}>
          {PHASE_NAMES.map((name, i) => {
            const p = (i + 1) as 1 | 2 | 3 | 4 | 5;
            const status: 'done' | 'current' | 'pending' =
              p < currentPhase ? 'done' : p === currentPhase ? 'current' : 'pending';
            return (
              <li
                key={name}
                style={{
                  padding: '4px 0',
                  color: status === 'pending' ? 'var(--ink-400)' : 'var(--ink-900)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ width: 14, textAlign: 'center', color: status === 'done' ? 'var(--jade)' : status === 'current' ? 'var(--navy-700)' : 'var(--ink-300)' }}>
                  {status === 'done' ? '✓' : status === 'current' ? '●' : '○'}
                </span>
                <span>
                  {p}. {name}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
