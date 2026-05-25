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

  // Resolve selected paths to full RefImage objects (preserves order).
  const attached = useMemo(() => {
    const byPath = new Map(library.map((r) => [r.path, r]));
    return selected
      .map((p) => byPath.get(p))
      .filter((r): r is RefImage => r !== undefined);
  }, [library, selected]);

  // Library minus the already-attached items, filtered by search.
  const availableFiltered = useMemo(() => {
    const sel = new Set(selected);
    const base = library.filter((img) => !sel.has(img.path));
    if (!filter) return base;
    const f = filter.toLowerCase();
    return base.filter(
      (img) =>
        img.label.toLowerCase().includes(f) ||
        CATEGORY_LABELS[img.category].toLowerCase().includes(f),
    );
  }, [library, selected, filter]);

  const availableByCategory = useMemo(() => {
    const map: Partial<Record<RefImageCategory, RefImage[]>> = {};
    for (const img of availableFiltered) {
      if (!map[img.category]) map[img.category] = [];
      map[img.category]!.push(img);
    }
    return map;
  }, [availableFiltered]);

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reference images"
      primaryAction={{ label: 'Done', onClick: () => onOpenChange(false) }}
    >
      <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {/* ── How this works ──────────────────────────────────────── */}
        <p
          style={{
            fontSize: 13,
            color: 'var(--ink-500)',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            lineHeight: 1.5,
            margin: '0 0 18px 0',
            padding: '10px 12px',
            background: 'var(--linen-100)',
            borderRadius: 6,
          }}
        >
          Leave empty to use the default character + dojo references Seedance
          auto-picks for this clip. Attach images below only to override the
          defaults for this clip.
        </p>

        {/* ── Override references ─────────────────────────────────── */}
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'var(--ink-500)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              Override references
            </div>
            <div
              style={{
                fontSize: 11,
                color: isFull ? 'var(--tassel)' : 'var(--ink-500)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {selected.length === 0
                ? 'using defaults'
                : `${selected.length} of ${MAX_REFS} overriding defaults`}
            </div>
          </div>

          {attached.length === 0 ? (
            <div
              style={{
                padding: '14px 16px',
                border: '1px dashed var(--ink-200)',
                borderRadius: 8,
                fontSize: 13,
                color: 'var(--ink-500)',
                textAlign: 'center',
              }}
            >
              Empty — Seedance will use the default character + dojo references
              for this clip.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {attached.map((img) => (
                <div
                  key={img.path}
                  style={{
                    position: 'relative',
                    width: 76,
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: 76,
                      height: 76,
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: 'var(--linen-50)',
                      border: '1.5px solid var(--navy-700)',
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
                  </div>
                  <button
                    type="button"
                    onClick={() => { void onRemove(img.path); }}
                    aria-label={`Remove ${img.label}`}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'var(--ink-900)',
                      color: 'white',
                      border: '2px solid white',
                      fontSize: 13,
                      lineHeight: 1,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                    }}
                  >
                    ×
                  </button>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: 'var(--ink-500)',
                      marginTop: 4,
                      maxWidth: 76,
                      lineHeight: 1.3,
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {img.label.replace(/^Rav Eli — /, '')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Add from library ────────────────────────────────────── */}
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'var(--ink-500)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              {isFull ? 'Library (full — remove one to swap in)' : 'Tap to override defaults'}
            </div>
          </div>

          {library.length > 20 && (
            <input
              type="text"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                width: '100%',
                minHeight: 40,
                fontSize: 16,
                padding: 10,
                marginBottom: 12,
                border: '1px solid var(--ink-100)',
                borderRadius: 6,
                boxSizing: 'border-box',
              }}
            />
          )}

          {CATEGORY_ORDER.filter((cat) => (availableByCategory[cat] ?? []).length > 0).map((cat) => (
            <div key={cat} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--ink-400)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: 6,
                }}
              >
                {CATEGORY_LABELS[cat]}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(availableByCategory[cat] ?? []).map((img) => (
                  <button
                    key={img.path}
                    type="button"
                    onClick={() => { if (!isFull) void onAdd(img.path); }}
                    disabled={isFull}
                    title={img.label}
                    style={{
                      width: 64,
                      height: 64,
                      padding: 0,
                      border: '1px solid var(--ink-100)',
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: 'var(--linen-50)',
                      cursor: isFull ? 'not-allowed' : 'pointer',
                      opacity: isFull ? 0.45 : 1,
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
                  </button>
                ))}
              </div>
            </div>
          ))}

          {availableFiltered.length === 0 && filter && (
            <p
              style={{
                fontSize: 13,
                color: 'var(--ink-500)',
                textAlign: 'center',
                padding: 16,
              }}
            >
              No images match the filter.
            </p>
          )}
        </section>
      </div>
    </BottomSheet>
  );
}
