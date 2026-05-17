// dashboard/src/app/videos/[slug]/_components/_shared/motion-picker-sheet.tsx
//
// Bottom-sheet Tai Chi move picker for Phase 2 (plan review) and Phase 3
// (clips). Per spec §6.5. Uses the BottomSheet primitive from M2.
//
// The "No move on this clip" option is pinned at the top of the list.
// The filter input renders only when moves.length > 15 — not pre-built
// for hypothetical scale.

'use client';
import { useState, useMemo } from 'react';
import { BottomSheet } from '../bottom-sheet';
import type { TaiChiMove } from '@/lib/tai-chi-moves';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moves: TaiChiMove[]; // fetched server-side, passed in
  currentSlug: string | null;
  onPick: (slug: string | null) => Promise<void>;
}

export function MotionPickerSheet({
  open,
  onOpenChange,
  moves,
  currentSlug,
  onPick,
}: Props) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return moves;
    const f = filter.toLowerCase();
    return moves.filter(
      (m) =>
        m.english.toLowerCase().includes(f) ||
        (m.pinyin ?? '').toLowerCase().includes(f),
    );
  }, [moves, filter]);

  async function pick(slug: string | null) {
    await onPick(slug);
    onOpenChange(false);
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Pick a Tai Chi move"
      primaryAction={{ label: 'Cancel', onClick: () => onOpenChange(false) }}
    >
      {moves.length > 15 && (
        <input
          type="text"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: '100%',
            minHeight: 44,
            fontSize: 16,
            padding: 10,
            marginBottom: 12,
            border: '1px solid var(--ink-100)',
            borderRadius: 6,
          }}
        />
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '60vh', overflowY: 'auto' }}>
        {/* "No move" option pinned at top */}
        <li>
          <button
            type="button"
            onClick={() => pick(null)}
            style={{
              width: '100%',
              minHeight: 56,
              padding: 12,
              textAlign: 'left',
              background: currentSlug === null ? 'var(--linen-50)' : 'white',
              border: '1px solid var(--ink-100)',
              borderRadius: 8,
              marginBottom: 6,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {currentSlug === null ? '● ' : '○ '}No move on this clip
          </button>
        </li>

        {filtered.map((m) => (
          <li key={m.slug}>
            <button
              type="button"
              onClick={() => pick(m.slug)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                minHeight: 64,
                padding: 8,
                textAlign: 'left',
                background: currentSlug === m.slug ? 'var(--linen-50)' : 'white',
                border: '1px solid var(--ink-100)',
                borderRadius: 8,
                marginBottom: 6,
                cursor: 'pointer',
              }}
            >
              {m.thumbVideoUrl ? (
                <video
                  src={m.thumbVideoUrl}
                  muted
                  playsInline
                  preload="metadata"
                  autoPlay
                  loop
                  style={{
                    width: 40,
                    height: 71,
                    borderRadius: 4,
                    objectFit: 'cover',
                    background: 'var(--ink-900)',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 40,
                    height: 71,
                    borderRadius: 4,
                    background: 'var(--ink-200)',
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {currentSlug === m.slug ? '● ' : '○ '}
                  {m.english}
                </div>
                {m.pinyin && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-500)',
                      fontStyle: 'italic',
                    }}
                  >
                    {m.pinyin}
                  </div>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
