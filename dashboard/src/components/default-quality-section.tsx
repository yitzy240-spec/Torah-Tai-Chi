'use client';

import { useState, useTransition } from 'react';
import { TIER_OPTIONS, type Resolution, type ModelTier } from '@/lib/seedance-pricing';
import { saveDefaultQuality } from '@/app/actions/save-default-quality';

interface DefaultQualitySectionProps {
  currentTierKey: string;
}

function tierKey(tier: ModelTier, resolution: Resolution) {
  return `${resolution} ${tier}`;
}

export function DefaultQualitySection({ currentTierKey }: DefaultQualitySectionProps) {
  const defaultOption =
    TIER_OPTIONS.find((o) => tierKey(o.tier, o.resolution) === currentTierKey) ?? TIER_OPTIONS[2];

  const [selected, setSelected] = useState(defaultOption);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveDefaultQuality(selected.resolution, selected.tier);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  };

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Default quality"
        style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}
      >
        {TIER_OPTIONS.map((option) => {
          const key = tierKey(option.tier, option.resolution);
          const isSelected = selected === option;
          return (
            <label
              key={key}
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr',
                gap: '14px',
                alignItems: 'center',
                padding: '13px 16px',
                border: `1px solid ${isSelected ? 'var(--navy-500)' : 'var(--ink-100)'}`,
                borderRadius: 'var(--r-md)',
                background: isSelected ? 'var(--navy-wash)' : 'var(--linen-50)',
                cursor: 'pointer',
                transition: 'all var(--trans)',
                position: 'relative',
              }}
              onClick={() => setSelected(option)}
            >
              <input
                type="radio"
                name="default-quality"
                value={key}
                checked={isSelected}
                onChange={() => setSelected(option)}
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
              />
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
              <div>
                <div
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontWeight: 500,
                    fontSize: '15px',
                    color: 'var(--ink-900)',
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
            </label>
          );
        })}
      </div>

      {error && (
        <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--tassel)', marginBottom: '12px' }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={isPending}
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
          border: saved ? '1px solid var(--jade)' : '1px solid var(--navy-800)',
          background: saved ? 'transparent' : 'var(--navy-800)',
          color: saved ? 'var(--jade)' : 'var(--linen-50)',
          cursor: isPending ? 'wait' : 'pointer',
          transition: 'all var(--trans)',
          opacity: isPending ? 0.7 : 1,
          boxShadow: saved ? 'none' : '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
        }}
      >
        {saved ? 'Saved' : isPending ? 'Saving…' : 'Save default'}
      </button>
    </div>
  );
}
