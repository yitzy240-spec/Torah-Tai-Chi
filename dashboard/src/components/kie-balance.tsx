'use client';

import { useEffect, useState } from 'react';

interface BalanceState {
  status: 'loading' | 'ok' | 'error';
  credits: number | null;
}

const LOW_THRESHOLD = 2000;
const POLL_MS = 60_000;

export function KieBalance() {
  const [state, setState] = useState<BalanceState>({ status: 'loading', credits: null });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/kie-balance', { cache: 'no-store' });
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok || typeof data.credits !== 'number') {
          setState({ status: 'error', credits: null });
        } else {
          setState({ status: 'ok', credits: data.credits });
        }
      } catch {
        if (!cancelled) setState({ status: 'error', credits: null });
      }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const low = state.status === 'ok' && state.credits !== null && state.credits < LOW_THRESHOLD;
  const numberColor = low ? 'var(--cedar-600)' : 'var(--ink-700)';

  return (
    <div
      style={{
        fontFamily: 'var(--ff-display)',
        fontStyle: 'italic',
        fontSize: '11.5px',
        color: 'var(--ink-500)',
        lineHeight: 1.5,
        fontVariationSettings: '"opsz" 14, "SOFT" 60',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span>
        Kie ·{' '}
        {state.status === 'loading' && <span style={{ opacity: 0.5 }}>loading…</span>}
        {state.status === 'error' && <span>balance unavailable</span>}
        {state.status === 'ok' && state.credits !== null && (
          <>
            {low && (
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--cedar-600)',
                  marginRight: 6,
                  animation: 'pulse-navy 1.8s ease-in-out infinite',
                }}
              />
            )}
            <strong style={{ fontStyle: 'normal', fontWeight: 500, color: numberColor }}>
              {state.credits.toLocaleString()}
            </strong>{' '}
            credits
          </>
        )}
      </span>
      <a
        href="https://kie.ai/billing"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--navy-700)',
          textDecoration: 'underline',
          textDecorationColor: 'var(--ink-200)',
          textUnderlineOffset: 2,
          fontSize: '11px',
          fontStyle: 'normal',
          fontFamily: 'var(--ff-body)',
        }}
      >
        Top up →
      </a>
    </div>
  );
}
