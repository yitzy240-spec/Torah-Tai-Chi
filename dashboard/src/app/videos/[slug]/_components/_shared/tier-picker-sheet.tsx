// dashboard/src/app/videos/[slug]/_components/_shared/tier-picker-sheet.tsx
//
// Bottom-sheet picker for Seedance render tier (resolution × model_tier).
// 4 options: 720p Fast, 720p Standard, 1080p Fast, 1080p Standard.
// Each row shows estimated cost for the current plan's total duration so
// the operator sees the dollar impact before committing.
//
// Default selection ('720p standard') matches Modal's NULL-fallback in
// modal_app.py lines 311-312 + 5674-5678. Picking a different tier
// passes resolution + model_tier explicitly into triggerClips, which
// writes them to the clips-only job row; Modal reads from the job row.
//
// No "save as default" toggle — global default lives on the Settings
// page. Picking here only affects this clips-only run.

'use client';
import { BottomSheet } from '../bottom-sheet';
import { estimateSeedanceCost } from '@/lib/seedance-pricing';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';

export interface TierChoice {
  resolution: Resolution;
  modelTier: ModelTier;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: TierChoice;
  /** Sum of all clip durations in this plan — used to estimate cost per option. */
  totalDurationS: number;
  onPick: (choice: TierChoice) => void;
}

const OPTIONS: Array<{
  resolution: Resolution;
  modelTier: ModelTier;
  label: string;
  hint: string;
}> = [
  { resolution: '720p',  modelTier: 'fast',     label: '720p Fast',      hint: 'fastest, lowest quality' },
  { resolution: '720p',  modelTier: 'standard', label: '720p Standard',  hint: 'usual default' },
  { resolution: '1080p', modelTier: 'fast',     label: '1080p Fast',     hint: 'hi-res, lower quality' },
  { resolution: '1080p', modelTier: 'standard', label: '1080p Standard', hint: 'highest cost + quality' },
];

export function TierPickerSheet({ open, onOpenChange, current, totalDurationS, onPick }: Props) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Render quality"
      primaryAction={{ label: 'Done', onClick: () => onOpenChange(false) }}
    >
      <p
        style={{
          fontSize: 13,
          color: 'var(--ink-500)',
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          lineHeight: 1.5,
          margin: '0 0 14px 0',
        }}
      >
        Applies to this video&apos;s clips only. Most videos use 720p Standard.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {OPTIONS.map((opt) => {
          const isSelected = opt.resolution === current.resolution && opt.modelTier === current.modelTier;
          const cost =
            totalDurationS > 0 ? estimateSeedanceCost(totalDurationS, opt.resolution, opt.modelTier) : null;
          return (
            <button
              key={`${opt.resolution}-${opt.modelTier}`}
              type="button"
              onClick={() => {
                onPick({ resolution: opt.resolution, modelTier: opt.modelTier });
                onOpenChange(false);
              }}
              aria-pressed={isSelected}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                minHeight: 56,
                background: isSelected ? 'var(--linen-100)' : 'white',
                border: `1px solid ${isSelected ? 'var(--navy-700)' : 'var(--ink-100)'}`,
                borderRadius: 10,
                textAlign: 'left',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: `2px solid ${isSelected ? 'var(--navy-700)' : 'var(--ink-200)'}`,
                  flexShrink: 0,
                  background: isSelected ? 'var(--navy-700)' : 'white',
                  boxShadow: isSelected ? 'inset 0 0 0 3px white' : undefined,
                }}
              />
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-900)' }}>
                  {opt.label}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{opt.hint}</span>
              </span>
              {cost !== null && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--ink-700)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  ~${cost.toFixed(2)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
