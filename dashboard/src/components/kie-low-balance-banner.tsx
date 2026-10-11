'use client';

import { useEffect, useState } from 'react';
import { CREDITS_PER_RENDER, DEFAULT_LOW_BALANCE_USD, usdToCredits } from '@/lib/kie-balance';

/**
 * Threshold below which we show the banner, and the observed cost of one
 * clip render used to translate credits into something meaningful.
 *
 * MEASURED from production jobs (2026-09): a 720p standard clip bills
 * ~450-530 credits (e.g. 492 credits = $2.87). The old threshold of 800
 * therefore fired when barely ONE render remained — far too late to act.
 * On 2026-09-22 Yonah ran 16 renders (~$42, ~7,100 credits), hit zero
 * mid-session, and got five "balance is insufficient" failures in a row.
 *
 * The threshold is now configurable (site_content
 * settings.kie_low_balance_usd → KIE_LOW_BALANCE_USD → $20, ~8 renders of
 * runway) and arrives with each /api/kie-balance response. The default
 * below only applies until the first response lands.
 */
const FALLBACK_LOW_THRESHOLD = usdToCredits(DEFAULT_LOW_BALANCE_USD);
// Bumped 60s → 5min and visibility-gated. See kie-balance.tsx for
// rationale — balance only changes when Modal runs a paid clip.
const POLL_MS = 300_000;

interface BalanceState {
  status: 'loading' | 'ok' | 'error';
  credits: number | null;
  lowThreshold: number;
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
  const [state, setState] = useState<BalanceState>({
    status: 'loading',
    credits: null,
    lowThreshold: FALLBACK_LOW_THRESHOLD,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/kie-balance', { cache: 'no-store' });
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok || typeof data.credits !== 'number') {
          setState((s) => ({ ...s, status: 'error', credits: null }));
        } else {
          setState({
            status: 'ok',
            credits: data.credits,
            lowThreshold:
              typeof data.lowThresholdCredits === 'number'
                ? data.lowThresholdCredits
                : FALLBACK_LOW_THRESHOLD,
          });
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, status: 'error', credits: null }));
      }
    };
    void load();
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load();
    }, POLL_MS);
    function onVisible() {
      if (document.visibilityState === 'visible') void load();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Hide while loading and on error — no banner is better than a
  // false-positive "out of credits" banner triggered by a transient
  // Kie/network blip. The user-facing case we care about is the
  // unambiguous one: credits are clearly low.
  if (state.status !== 'ok' || state.credits === null) return null;
  if (state.credits >= state.lowThreshold) return null;

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
            : `Kie credits low — about ${Math.floor(state.credits / CREDITS_PER_RENDER)} render${
                Math.floor(state.credits / CREDITS_PER_RENDER) === 1 ? '' : 's'
              } left`}
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
            ? 'Any new render will fail on Kie’s side (you won’t be charged). Top up before re-rendering.'
            : `${state.credits.toLocaleString()} credits left; one clip render costs about ${CREDITS_PER_RENDER}. Top up before you start a session.`}
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
