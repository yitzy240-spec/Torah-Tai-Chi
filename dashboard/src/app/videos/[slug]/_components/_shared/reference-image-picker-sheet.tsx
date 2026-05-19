// dashboard/src/app/videos/[slug]/_components/_shared/reference-image-picker-sheet.tsx
//
// Bottom-sheet reference image picker for Phase 2 (plan review).
// Mirrors the motion-picker-sheet.tsx pattern.
//
// Each reference image comes from the project's references/ Storage library.
// Categories: Character, Dojo, Jewish ritual, Other.
// 9-slot cap enforced visually; filter when library > 20 items.
//
// Per spec B4 §1. Seedance constraint: max 9 reference images per clip.

'use client';
import { useState, useMemo } from 'react';
import { BottomSheet } from '../bottom-sheet';

export type RefImageCategory = 'character' | 'dojo' | 'jewish' | 'other';

export interface RefImage {
  path: string; // Storage path, e.g. "refs/char/rav-eli-1.png"
  label: string;
  category: RefImageCategory;
  thumbUrl?: string; // public URL for 50×50 preview
}

const CATEGORY_LABELS: Record<RefImageCategory, string> = {
  character: 'Character',
  dojo: 'Dojo',
  jewish: 'Jewish ritual',
  other: 'Other',
};

const CATEGORY_ORDER: RefImageCategory[] = ['character', 'dojo', 'jewish', 'other'];

const MAX_REFS = 9;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library: RefImage[]; // full library passed from server
  selected: string[]; // currently selected paths on this clip
  onAdd: (path: string) => Promise<void>;
  onRemove: (path: string) => Promise<void>;
}

export function ReferenceImagePickerSheet({
  open,
  onOpenChange,
  library,
  selected,
  onAdd,
  onRemove,
}: Props) {
  const [filter, setFilter] = useState('');

  const isFull = selected.length >= MAX_REFS;

  const filtered = useMemo(() => {
    if (!filter) return library;
    const f = filter.toLowerCase();
    return library.filter(
      (img) =>
        img.label.toLowerCase().includes(f) ||
        CATEGORY_LABELS[img.category].toLowerCase().includes(f),
    );
  }, [library, filter]);

  const byCategory = useMemo(() => {
    const map: Partial<Record<RefImageCategory, RefImage[]>> = {};
    for (const img of filtered) {
      if (!map[img.category]) map[img.category] = [];
      map[img.category]!.push(img);
    }
    return map;
  }, [filtered]);

  async function toggle(path: string) {
    if (selected.includes(path)) {
      await onRemove(path);
    } else if (!isFull) {
      await onAdd(path);
    }
    // If full and trying to add: no-op (UI already shows "Full" banner).
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reference images"
      primaryAction={{ label: 'Done', onClick: () => onOpenChange(false) }}
    >
      {isFull && (
        <div
          style={{
            background: 'var(--linen-100)',
            border: '1px solid var(--ink-100)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 13,
            color: 'var(--ink-700)',
            marginBottom: 12,
          }}
        >
          Full — remove one to add another.
        </div>
      )}

      {library.length > 20 && (
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
            boxSizing: 'border-box',
          }}
        />
      )}

      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {CATEGORY_ORDER.filter((cat) => (byCategory[cat] ?? []).length > 0).map((cat) => (
          <div key={cat} style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 10,
                color: 'var(--ink-500)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: 8,
              }}
            >
              {CATEGORY_LABELS[cat]}
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              {(byCategory[cat] ?? []).map((img) => {
                const isSelected = selected.includes(img.path);
                const disabled = isFull && !isSelected;
                return (
                  <button
                    key={img.path}
                    type="button"
                    onClick={() => toggle(img.path)}
                    disabled={disabled}
                    title={img.label}
                    style={{
                      width: 64,
                      height: 64,
                      padding: 0,
                      border: isSelected
                        ? '2px solid var(--navy-700)'
                        : '1px solid var(--ink-100)',
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: 'var(--linen-50)',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.45 : 1,
                      position: 'relative',
                      flexShrink: 0,
                    }}
                  >
                    {img.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img.thumbUrl}
                        alt={img.label}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          background: 'var(--ink-100)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          color: 'var(--ink-500)',
                          textAlign: 'center',
                          padding: 4,
                        }}
                      >
                        {img.label}
                      </div>
                    )}
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: 'var(--navy-700)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <span style={{ color: 'white', fontSize: 10, lineHeight: 1 }}>✓</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p style={{ fontSize: 14, color: 'var(--ink-500)', textAlign: 'center', padding: 16 }}>
            No images match the filter.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
