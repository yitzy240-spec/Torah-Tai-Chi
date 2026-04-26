'use client';

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { TIER_OPTIONS, estimateSeedanceCost, type Resolution, type ModelTier } from '@/lib/seedance-pricing';
import { triggerGeneration } from '@/app/actions/trigger-generation';

// Rough Claude clip-plan cost per generation. Now billed through Kie too
// since the Anthropic migration, so it counts against the same balance.
const CLAUDE_PLAN_COST_USD = 0.06;

interface GenerateDialogProps {
  parshaId: string;
  scriptId: string;
  parshaName: string;
  /** When the script's parsha is half of a combined-parsha pair this week,
   *  the OTHER parsha id in the pair — recorded on the job so /parshiot
   *  can credit both rows of the 54-grid with the resulting video. */
  partnerParshaId?: string;
  /** Expected total video duration in seconds; falls back to 60 */
  expectedDurationS?: number;
  /** Pre-selected tier key from settings.default_tier (e.g. "720p standard") */
  defaultTierKey?: string;
  onJobCreated?: (jobId: string) => void;
  /** Label on the trigger button. Defaults to "Approve · generate video". */
  triggerLabel?: string;
  /** "primary" (solid navy) or "secondary" (outline). Defaults to primary. */
  triggerVariant?: 'primary' | 'secondary';
}

function tierKey(tier: ModelTier, resolution: Resolution) {
  return `${resolution} ${tier}`;
}

export function GenerateDialog({
  parshaId,
  scriptId,
  parshaName,
  partnerParshaId,
  expectedDurationS = 60,
  defaultTierKey = '720p fast',
  onJobCreated,
  triggerLabel = 'Approve · generate video',
  triggerVariant = 'primary',
}: GenerateDialogProps) {
  const defaultOption =
    TIER_OPTIONS.find((o) => tierKey(o.tier, o.resolution) === defaultTierKey) ?? TIER_OPTIONS[2];

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(defaultOption);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [balanceUsd, setBalanceUsd] = useState<number | null>(null);
  const [balanceErr, setBalanceErr] = useState<string | null>(null);

  const seedanceCost = estimateSeedanceCost(expectedDurationS, selected.resolution, selected.tier);
  const totalCost = seedanceCost === null ? null : seedanceCost + CLAUDE_PLAN_COST_USD;
  const insufficient =
    balanceUsd !== null && totalCost !== null && balanceUsd < totalCost;

  // Fetch Kie balance whenever the dialog opens — avoids stale figures
  // if the user left the dialog mounted for a while.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBalanceErr(null);
    fetch('/api/kie-balance', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data?.usdBalance === 'number') {
          setBalanceUsd(data.usdBalance);
        } else {
          setBalanceErr('balance unavailable');
        }
      })
      .catch(() => { if (!cancelled) setBalanceErr('balance unavailable'); });
    return () => { cancelled = true; };
  }, [open]);

  const openDialog = () => {
    setSelected(defaultOption);
    setError(null);
    setOpen(true);
    document.body.style.overflow = 'hidden';
  };

  const closeDialog = () => {
    setOpen(false);
    document.body.style.overflow = '';
  };

  const generate = () => {
    setError(null);
    startTransition(async () => {
      const result = await triggerGeneration({
        parshaId,
        scriptId,
        partnerParshaId,
        resolution: selected.resolution,
        modelTier: selected.tier,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      closeDialog();
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 3400);
      if (result.jobId && onJobCreated) onJobCreated(result.jobId);
    });
  };

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={openDialog}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'var(--ff-body)',
          fontWeight: 500,
          fontSize: '14px',
          padding: '11px 22px',
          minHeight: '44px',
          borderRadius: '999px',
          border: `1px solid ${triggerVariant === 'secondary' ? 'var(--ink-200)' : 'var(--navy-800)'}`,
          background: triggerVariant === 'secondary' ? 'transparent' : 'var(--navy-800)',
          color: triggerVariant === 'secondary' ? 'var(--ink-700)' : 'var(--linen-50)',
          cursor: 'pointer',
          transition: 'all var(--trans)',
          boxShadow: triggerVariant === 'secondary'
            ? 'none'
            : '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
        }}
      >
        {triggerLabel}
      </button>

      {typeof document !== 'undefined' && createPortal(
      <>
      {/* Scrim */}
      {open && (
        <div
          onClick={closeDialog}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 30,
            background: 'rgba(35,27,16,.38)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
          aria-hidden="true"
        />
      )}

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gen-dialog-title"
        style={{
          position: 'fixed',
          zIndex: 31,
          left: '50%',
          top: '50%',
          transform: open ? 'translate(-50%, -50%)' : 'translate(-50%, calc(-50% + 20px))',
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: 'var(--linen-50)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-xl)',
          boxShadow: '0 30px 80px -30px rgba(35,27,16,.45)',
          padding: '36px 40px 32px',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity var(--trans), transform var(--trans)',
        }}
      >
        {/* Header */}
        <h2
          id="gen-dialog-title"
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(22px, 3vw, 28px)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: '0 0 8px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 36, "SOFT" 30',
          }}
        >
          Pick the quality for{' '}
          <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 36, "SOFT" 60' }}>
            {parshaName}
          </em>
        </h2>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13.5px',
            color: 'var(--ink-500)',
            margin: '0 0 24px 0',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          You can change the default in Settings.
        </p>

        {/* Radio cards */}
        <div role="radiogroup" aria-label="Quality tier" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {TIER_OPTIONS.map((option) => {
            const optCost = estimateSeedanceCost(expectedDurationS, option.resolution, option.tier);
            const isSelected = selected === option;
            return (
              <label
                key={tierKey(option.tier, option.resolution)}
                style={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr auto',
                  gap: '14px',
                  alignItems: 'center',
                  padding: '14px 16px',
                  border: `1px solid ${isSelected ? 'var(--navy-500)' : 'var(--ink-100)'}`,
                  borderRadius: 'var(--r-md)',
                  background: isSelected ? 'var(--navy-wash)' : 'var(--linen-50)',
                  cursor: 'pointer',
                  transition: 'all var(--trans)',
                }}
                onClick={() => setSelected(option)}
              >
                <input
                  type="radio"
                  name="quality-tier"
                  value={tierKey(option.tier, option.resolution)}
                  checked={isSelected}
                  onChange={() => setSelected(option)}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                />
                {/* Radio dot */}
                <span
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    border: `1.5px solid ${isSelected ? 'var(--navy-800)' : 'var(--ink-300)'}`,
                    background: 'var(--linen-50)',
                    display: 'grid',
                    placeItems: 'center',
                    transition: 'all var(--trans)',
                    flexShrink: 0,
                  }}
                >
                  {isSelected && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--navy-800)', display: 'block' }} />
                  )}
                </span>

                {/* Label + note */}
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontWeight: 500,
                      fontSize: '15px',
                      color: 'var(--ink-900)',
                      letterSpacing: '-0.005em',
                      fontVariationSettings: '"opsz" 18, "SOFT" 20',
                    }}
                  >
                    {option.label}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                      fontSize: '12.5px',
                      color: 'var(--ink-500)',
                      marginTop: '2px',
                      fontVariationSettings: '"opsz" 14, "SOFT" 50',
                    }}
                  >
                    {option.note}
                  </div>
                </div>

                {/* Cost */}
                <div
                  style={{
                    fontFamily: '"Courier New", Courier, monospace',
                    fontSize: '14px',
                    fontVariantNumeric: 'tabular-nums',
                    color: isSelected ? 'var(--navy-800)' : 'var(--ink-500)',
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {optCost !== null ? `~$${optCost.toFixed(2)}` : 'N/A'}
                </div>
              </label>
            );
          })}
        </div>

        {/* Total */}
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--ink-100)',
            borderRadius: 'var(--r-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginBottom: insufficient ? '14px' : '24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '14px',
                color: 'var(--ink-700)',
                fontVariationSettings: '"opsz" 14, "SOFT" 40',
              }}
            >
              Estimated total ({expectedDurationS}s video)
            </span>
            <span
              style={{
                fontFamily: '"Courier New", Courier, monospace',
                fontSize: '20px',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--ink-900)',
              }}
            >
              {totalCost !== null ? `$${totalCost.toFixed(2)}` : 'N/A'}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '12.5px',
              color: insufficient ? 'var(--tassel)' : 'var(--ink-500)',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
            }}
          >
            <span>
              Kie balance{' '}
              {balanceUsd !== null ? (
                <strong
                  style={{
                    fontFamily: '"Courier New", Courier, monospace',
                    fontStyle: 'normal',
                    fontVariantNumeric: 'tabular-nums',
                    color: insufficient ? 'var(--tassel)' : 'var(--ink-700)',
                  }}
                >
                  ${balanceUsd.toFixed(2)}
                </strong>
              ) : balanceErr ? (
                <span style={{ opacity: 0.7 }}>unavailable</span>
              ) : (
                <span style={{ opacity: 0.5 }}>loading…</span>
              )}
            </span>
            {insufficient && (
              <a
                href="https://kie.ai/billing"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontStyle: 'normal',
                  fontSize: '12px',
                  color: 'var(--tassel)',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                Top up →
              </a>
            )}
          </div>
        </div>
        {insufficient && (
          <div
            style={{
              padding: '10px 14px',
              marginBottom: '16px',
              borderRadius: 'var(--r-sm)',
              background: 'rgba(192,57,43,.08)',
              border: '1px solid rgba(192,57,43,.2)',
              color: '#8b2d1c',
              fontFamily: 'var(--ff-body)',
              fontSize: '12.5px',
              lineHeight: 1.5,
            }}
          >
            Not enough Kie credits for this run. Top up at{' '}
            <a href="https://kie.ai/billing" target="_blank" rel="noopener noreferrer" style={{ color: '#8b2d1c' }}>kie.ai/billing</a>{' '}
            — your auto-top-off may also refill within a few minutes.
          </div>
        )}

        {/* Error */}
        {error && (
          <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--tassel)', marginBottom: '16px' }}>
            {error}
          </p>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeDialog}
            disabled={isPending}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: '14px',
              padding: '11px 22px',
              minHeight: '44px',
              borderRadius: '999px',
              border: '1px solid var(--ink-200)',
              background: 'transparent',
              color: 'var(--ink-700)',
              cursor: 'pointer',
              transition: 'all var(--trans)',
              opacity: isPending ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={isPending || insufficient}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: '14px',
              padding: '11px 22px',
              minHeight: '44px',
              borderRadius: '999px',
              border: `1px solid ${insufficient ? 'var(--ink-200)' : 'var(--navy-800)'}`,
              background: insufficient ? 'var(--ink-300)' : 'var(--navy-800)',
              color: 'var(--linen-50)',
              cursor: isPending || insufficient ? 'not-allowed' : 'pointer',
              transition: 'all var(--trans)',
              boxShadow: insufficient ? 'none' : '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
              opacity: isPending ? 0.7 : 1,
            }}
            title={insufficient ? 'Top up Kie credits first' : undefined}
          >
            {isPending ? 'Queuing…' : insufficient ? 'Insufficient balance' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Toast */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          zIndex: 40,
          bottom: '28px',
          left: '50%',
          transform: toastVisible ? 'translate(-50%, 0)' : 'translate(-50%, 40px)',
          padding: '12px 20px 12px 16px',
          background: 'var(--ink-900)',
          color: 'var(--linen-50)',
          borderRadius: '999px',
          fontFamily: 'var(--ff-body)',
          fontSize: '13.5px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          opacity: toastVisible ? 1 : 0,
          pointerEvents: 'none',
          transition: 'all var(--trans)',
          boxShadow: '0 20px 40px -20px rgba(35,27,16,.4)',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: 'var(--jade)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--linen-50)',
            flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: '10px', height: '10px' }}>
            <path d="M2.5 6.2l2.4 2.3 4.6-4.8"/>
          </svg>
        </span>
        <span>Video generation queued — progress shows on the script card.</span>
      </div>
      </>,
      document.body
      )}
    </>
  );
}
