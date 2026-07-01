// dashboard/src/app/videos/[slug]/_components/transitions-control.tsx
//
// Per-cut transition control under the stitched video (Phase 4). Each cut is
// Auto by default (hard within a scene, dissolve at a scene break); the
// operator can force a specific cut to Hard cut or Dissolve. Applying
// re-stitches the SAME clips (no re-generation) via restitchVideo.

'use client';
import { useState } from 'react';
import { restitchVideo } from '@/app/actions/restitch-video';
import type { CutType } from '../_data/phase-4-data';

const LABEL: Record<CutType, string> = { hard: 'Hard cut', fade: 'Fade' };

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.round(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

interface Props {
  videoId: string;
  /** Auto decision per cut (index i = cut after clip i). */
  autoCutTypes: CutType[];
  /** Stored operator overrides. */
  cutOverrides: Record<string, CutType>;
  /** Cumulative clip start offsets, e.g. [0, 9, 19, 28]. */
  clipBoundariesS: number[];
  onRestitchStart: () => void;
}

export function TransitionsControl({
  videoId, autoCutTypes, cutOverrides, clipBoundariesS, onRestitchStart,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, CutType>>(cutOverrides);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cutCount = Math.max(0, clipBoundariesS.length - 1);
  if (cutCount < 1) return null;

  const overrideCount = Object.keys(overrides).length;
  const dirty = JSON.stringify(overrides) !== JSON.stringify(cutOverrides);
  const summary = overrideCount === 0 ? 'Auto' : `${overrideCount} custom`;

  function choose(i: number, choice: 'auto' | CutType) {
    setOverrides((o) => {
      const n = { ...o };
      if (choice === 'auto') delete n[String(i)];
      else n[String(i)] = choice;
      return n;
    });
  }

  async function onApply() {
    setBusy(true);
    setError(null);
    const res = await restitchVideo({ videoId, cuts: overrides });
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
        <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 10 }}>
          Each cut is set automatically — hard cut within a scene, dissolve when the scene changes. Override any cut here.
        </div>

        {Array.from({ length: cutCount }, (_, i) => {
          const auto = autoCutTypes[i] ?? 'hard';
          const current: 'auto' | CutType = overrides[String(i)] ?? 'auto';
          const at = clipBoundariesS[i + 1] ?? 0;
          const options: Array<{ key: 'auto' | CutType; label: string }> = [
            { key: 'auto', label: `Auto (${LABEL[auto]})` },
            { key: 'hard', label: 'Hard cut' },
            { key: 'fade', label: 'Fade' },
          ];
          return (
            <div key={i} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ink-100)' }}>
              <div style={{ fontSize: 12, color: 'var(--ink-700)', marginBottom: 6 }}>Cut {i + 1} · {fmtTime(at)}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {options.map((opt) => {
                  const active = current === opt.key;
                  return (
                    <button key={opt.key} type="button" onClick={() => choose(i, opt.key)}
                      style={{ flex: 1, minHeight: 40, fontSize: 12, fontWeight: active ? 600 : 400,
                        background: active ? 'var(--navy-700)' : 'white',
                        color: active ? 'var(--linen-50)' : 'var(--ink-700)',
                        border: `1px solid ${active ? 'var(--navy-700)' : 'var(--ink-100)'}`,
                        borderRadius: 8, cursor: 'pointer', padding: '4px 6px' }}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

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
