'use client';

import { useEffect, useState } from 'react';

/**
 * Threshold below which we show the banner. A typical 720p Fast regen
 * costs ~240 credits, a 1080p Standard ~720, so 800 credits ≈ "barely
 * enough for one render at the higher quality" — that's the floor at
 * which Yonah needs a heads-up before the next click silently fails on
 * the Kie side. The sidebar's existing pulsing-dot indicator stays at
 * the same threshold for consistency.
 */
const LOW_THRESHOLD = 800;
const POLL_MS = 60_000;

interface BalanceState {
  status: 'loading' | 'ok' | 'error';
  credits: number | null;
}

/**
 * Always-on layout banner that appears at the top of every authenticated
 * page when Kie credits are below LOW_THRESHOLD (or zero). Shown on
 * mobile AND desktop — the sidebar credit indicator only renders on
 * desktop and Yonah works on his phone, so a phone-only render of a
 * "$0 balance" warning is essential to keep him from running renders
 * that will silently fail on Kie's end.
 *
 * Polls /api/kie-balance every 60s, same cadence as the sidebar
 * component — both queries hit the same Next.js handler so this
 * doesn't double our quota cost in any meaningful way.
 */
export function KieLowBalanceBanner() {
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

  // Hide while loading and on error — no banner is better than a
  // false-positive "out of credits" banner triggered by a transient
  // Kie/network blip. The user-facing case we care about is the
  // unambiguous one: credits are clearly low.
  if (state.status !== 'ok' || state.credits === null) return null;
  if (state.credits >= LOW_THRESHOLD) return null;

  const exhausted = state.credits <= 0;
  return (
    <div
      role="alert"
      style={{
        marginBottom: 22,
        padding: '14px 18px',
        border: `1px solid ${exhausted ? 'var(--tassel)' : 'var(--cedar-500)'}`,
        borderRadius: 'var(--r-md)',
        background: exhausted ? 'rgba(192,57,43,.08)' : 'rgba(168,114,47,.08)',
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: 15,
            color: 'var(--ink-900)',
            marginBottom: 4,
            fontVariationSettings: '"opsz" 18, "SOFT" 30',
          }}
        >
          {exhausted
            ? 'Kie credits are exhausted'
            : `Kie credits low — ${state.credits.toLocaleString()} left`}
        </div>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: 13,
            color: 'var(--ink-500)',
            lineHeight: 1.5,
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          {exhausted
            ? 'Any new render will fail on Kie’s side. Top up before re-rendering.'
            : 'A typical re-render costs 240–720 credits. Top up before scheduling more.'}
        </div>
      </div>
      <a
        href="https://kie.ai/billing"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          alignSelf: 'center',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px',
          borderRadius: '999px',
          border: `1px solid ${exhausted ? 'var(--tassel)' : 'var(--cedar-700)'}`,
          background: exhausted ? 'var(--tassel)' : 'var(--cedar-700)',
          color: 'var(--linen-50)',
          fontFamily: 'var(--ff-body)',
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        Top up at Kie →
      </a>
    </div>
  );
}
