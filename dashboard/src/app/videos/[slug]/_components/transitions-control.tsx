// dashboard/src/app/videos/[slug]/_components/transitions-control.tsx
//
// Auto + Tighter/Looser transition control, shown under the stitched video
// (Phase 4). Default is Auto — most videos never touch this. Tapping expands
// to a global pacing stepper and an optional per-cut fine-tune list. Applying
// re-stitches the SAME clips (no re-generation) via restitchVideo.
//
// Levels: -2 Much tighter · -1 Tighter · 0 Auto · +1 Looser · +2 Much looser.
// Per-cut rows show the effective level (inherited from global unless the
// operator nudges that specific cut). See the 2026-06-24 design spec.

'use client';
import { useState } from 'react';
import { restitchVideo } from '@/app/actions/restitch-video';

const LEVEL_LABELS = ['Much tighter', 'Tighter', 'Auto', 'Looser', 'Much looser'];
const levelLabel = (l: number) => LEVEL_LABELS[l + 2] ?? 'Auto';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.round(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

interface Props {
  videoId: string;
  initialLevel: number;
  initialJoins: Record<string, number>;
  /** Cumulative clip start offsets, e.g. [0, 9, 19, 28]. cuts = length - 1. */
  clipBoundariesS: number[];
  /** Parent flips to the re-stitching spinner. */
  onRestitchStart: () => void;
}

function Stepper({
  value, onChange, min = -2, max = 2,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const btn: React.CSSProperties = {
    width: 40, minHeight: 40, fontSize: 20, lineHeight: 1, fontWeight: 500,
    background: 'white', color: 'var(--navy-700)', border: '1px solid var(--ink-100)',
    borderRadius: 8, cursor: 'pointer',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" aria-label="Tighter" onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min} style={{ ...btn, opacity: value <= min ? 0.4 : 1 }}>−</button>
      <div style={{ minWidth: 96, textAlign: 'center', fontSize: 13, fontWeight: 500, color: 'var(--ink-900)' }}>
        {levelLabel(value)}
      </div>
      <button type="button" aria-label="Looser" onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max} style={{ ...btn, opacity: value >= max ? 0.4 : 1 }}>+</button>
    </div>
  );
}

export function TransitionsControl({
  videoId, initialLevel, initialJoins, clipBoundariesS, onRestitchStart,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showPerCut, setShowPerCut] = useState(Object.keys(initialJoins).length > 0);
  const [level, setLevel] = useState(initialLevel);
  const [joins, setJoins] = useState<Record<string, number>>(initialJoins);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cutCount = Math.max(0, clipBoundariesS.length - 1);
  const overrideCount = Object.keys(joins).filter((k) => joins[k] !== level).length;

  // Dirty vs what's currently stitched (initial props).
  const dirty =
    level !== initialLevel ||
    JSON.stringify(normalize(joins, level)) !== JSON.stringify(normalize(initialJoins, initialLevel));

  const summary =
    level === 0 && overrideCount === 0 ? 'Auto'
      : overrideCount > 0 ? `${levelLabel(level)} · ${overrideCount} custom`
        : levelLabel(level);

  function setCut(idx: number, v: number) {
    setJoins((j) => ({ ...j, [idx]: v }));
  }
  function resetCut(idx: number) {
    setJoins((j) => { const n = { ...j }; delete n[String(idx)]; return n; });
  }

  async function onApply() {
    setBusy(true);
    setError(null);
    const res = await restitchVideo({ videoId, settings: { level, joins } });
    setBusy(false);
    if ('error' in res) { setError(res.error); return; }
    onRestitchStart();
  }

  const box: React.CSSProperties = {
    border: '1px solid var(--ink-100)', borderRadius: 10, marginTop: 14,
    background: 'var(--linen-50)', overflow: 'hidden',
  };

  if (!expanded) {
    return (
      <div style={box}>
        <button type="button" onClick={() => setExpanded(true)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', minHeight: 48, background: 'transparent', border: 'none',
            cursor: 'pointer', fontSize: 13, color: 'var(--ink-700)' }}>
          <span>Transitions: <strong style={{ color: 'var(--ink-900)' }}>{summary}</strong></span>
          <span aria-hidden style={{ color: 'var(--ink-400)' }}>Adjust ▾</span>
        </button>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--ink-100)' }}>
        <strong style={{ fontSize: 14, color: 'var(--ink-900)' }}>Transitions</strong>
        <button type="button" onClick={() => setExpanded(false)}
          style={{ background: 'none', border: 'none', color: 'var(--ink-400)', cursor: 'pointer', fontSize: 13, minHeight: 40, padding: '0 4px' }}>Close ▴</button>
      </div>

      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-700)', marginBottom: 8 }}>Overall pacing</div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Stepper value={level} onChange={setLevel} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-400)', textAlign: 'center', marginTop: 6 }}>
          Auto sizes each pause to the speech. Tighter/Looser shifts them all.
        </div>

        {cutCount > 1 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--ink-100)', paddingTop: 12 }}>
            {!showPerCut ? (
              <button type="button" onClick={() => setShowPerCut(true)}
                style={{ background: 'none', border: 'none', color: 'var(--navy-700)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12, minHeight: 40, padding: 0 }}>
                Fine-tune a single cut →
              </button>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 8 }}>
                  Each cut follows Overall unless you change it here.
                </div>
                {Array.from({ length: cutCount }, (_, i) => {
                  const overridden = joins[i] !== undefined && joins[i] !== level;
                  const effective = joins[i] ?? level;
                  const at = clipBoundariesS[i + 1] ?? 0;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ink-100)' }}>
                      <div style={{ fontSize: 12, color: 'var(--ink-700)', minWidth: 78 }}>
                        Cut {i + 1} · {fmtTime(at)}
                        {overridden && <span style={{ color: 'var(--navy-700)', fontWeight: 500 }}> · custom</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Stepper value={effective} onChange={(v) => setCut(i, v)} />
                        {overridden && (
                          <button type="button" onClick={() => resetCut(i)} aria-label="Reset this cut to Overall"
                            style={{ background: 'none', border: 'none', color: 'var(--ink-400)', cursor: 'pointer', fontSize: 16, minHeight: 40, padding: '0 4px' }}>↺</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--tassel)', marginTop: 10 }}>{error}</div>}

        <button type="button" onClick={onApply} disabled={busy || !dirty}
          style={{ width: '100%', minHeight: 48, marginTop: 14, fontSize: 14, fontWeight: 500,
            background: dirty ? 'var(--navy-700)' : 'var(--ink-100)', color: dirty ? 'var(--linen-50)' : 'var(--ink-400)',
            border: 'none', borderRadius: 10, cursor: busy || !dirty ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Starting re-stitch…' : dirty ? 'Apply & re-stitch' : 'No changes to apply'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--ink-400)', textAlign: 'center', marginTop: 6 }}>
          Re-joins your clips · about a minute · no re-generation
        </div>
      </div>
    </div>
  );
}

// Normalize joins for dirty-comparison: drop entries equal to the global
// level (they're inherited, not real overrides).
function normalize(joins: Record<string, number>, level: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(joins)) if (v !== level) out[k] = v;
  return out;
}
