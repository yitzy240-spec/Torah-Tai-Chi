'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TaiChiMove {
  slug: string;
  english: string;
  pinyin: string;
  section: string;
  duration_s: number;
  mp4_url: string;
}

interface Props {
  open: boolean;
  currentSlug: string | null;
  onSelect: (slug: string | null) => void;
  onClose: () => void;
}

const SECTION_LABELS: Record<string, string> = {
  yang_24_form: 'Yang 24-form',
  basic_stances: 'Basic stances',
  chen_style: 'Chen-style',
  other: 'Other',
};

function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? SECTION_LABELS.other;
}

export function TaiChiMovePicker({ open, currentSlug, onSelect, onClose }: Props) {
  const [moves, setMoves] = useState<TaiChiMove[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(currentSlug);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  useEffect(() => { setSelected(currentSlug); }, [currentSlug]);

  useEffect(() => {
    if (!open || moves !== null) return;
    fetch('/api/tai-chi-moves', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setMoves(data.moves ?? []))
      .catch(() => setMoves([]));
  }, [open, moves]);

  // Lock body scroll when open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = moves ?? [];
    if (!q) return list;
    return list.filter((m) =>
      m.english.toLowerCase().includes(q) || m.pinyin.toLowerCase().includes(q),
    );
  }, [moves, query]);

  const grouped = useMemo(() => {
    const bySection = new Map<string, TaiChiMove[]>();
    for (const m of filtered) {
      const arr = bySection.get(m.section) ?? [];
      arr.push(m);
      bySection.set(m.section, arr);
    }
    const sectionOrder = ['yang_24_form', 'basic_stances', 'chen_style'];
    const known = sectionOrder
      .filter((s) => bySection.has(s))
      .map((s) => [s, bySection.get(s)!] as const);
    const extras = [...bySection.entries()]
      .filter(([s]) => !sectionOrder.includes(s))
      .sort();
    return [...known, ...extras];
  }, [filtered]);

  const togglePreview = (slug: string) => {
    if (previewing && previewing !== slug) {
      const prev = videoRefs.current.get(previewing);
      if (prev) prev.pause();
    }
    if (previewing === slug) {
      const v = videoRefs.current.get(slug);
      if (v) v.pause();
      setPreviewing(null);
    } else {
      setPreviewing(slug);
      // Play on next tick after the video mounts.
      setTimeout(() => {
        const v = videoRefs.current.get(slug);
        if (v) { v.currentTime = 0; v.play().catch(() => {}); }
      }, 20);
    }
  };

  const commit = () => {
    onSelect(selected);
    onClose();
  };

  if (!open || typeof document === 'undefined') return null;

  const sheet = (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 30,
          background: 'rgba(35,27,16,.38)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      />
      {/* Sheet */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-picker-title"
        style={{
          position: 'fixed', zIndex: 31,
          top: 0, right: 0, bottom: 0,
          height: '100vh',
          width: 'min(520px, 100vw)',
          background: 'var(--linen-50)',
          borderLeft: '1px solid var(--ink-200)',
          boxShadow: '-30px 0 80px -30px rgba(35,27,16,.45)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{ padding: '24px 28px 16px', borderBottom: '1px solid var(--ink-100)' }}>
          <h2 id="move-picker-title" style={{
            fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: '24px',
            margin: 0, color: 'var(--ink-900)',
          }}>Add a tai chi move</h2>
          <p style={{
            fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '13.5px',
            color: 'var(--ink-500)', margin: '6px 0 16px 0',
          }}>Optional — pick one to feature in one of the dojo beats.</p>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by English name or pinyin…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 14px',
              fontFamily: 'var(--ff-body)', fontSize: '14px',
              border: '1px solid var(--ink-200)', borderRadius: 'var(--r-md)',
              background: 'white', outline: 'none',
            }}
          />
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 28px 24px' }}>
          {moves === null && (
            <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--ink-500)' }}>
              Loading library…
            </p>
          )}
          {moves !== null && filtered.length === 0 && (
            <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--ink-500)' }}>
              No moves match that search.
            </p>
          )}
          {grouped.map(([section, items]) => (
            <section key={section} style={{ marginTop: '20px' }}>
              <h3 style={{
                fontFamily: 'var(--ff-body)', fontSize: '11px', fontWeight: 600,
                letterSpacing: '0.14em', textTransform: 'uppercase',
                color: 'var(--cedar-600)', margin: '0 0 8px 0',
              }}>{sectionLabel(section)}</h3>
              {items.map((move) => {
                const isSelected = selected === move.slug;
                const isPreviewing = previewing === move.slug;
                return (
                  <div key={move.slug} style={{ marginBottom: '6px' }}>
                    <label
                      onClick={() => setSelected(move.slug)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '20px 1fr auto',
                        gap: '12px', alignItems: 'center',
                        padding: '10px 12px',
                        border: `1px solid ${isSelected ? 'var(--navy-500)' : 'var(--ink-100)'}`,
                        borderRadius: 'var(--r-md)',
                        background: isSelected ? 'var(--navy-wash)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: '50%',
                        border: `1.5px solid ${isSelected ? 'var(--navy-800)' : 'var(--ink-300)'}`,
                        background: 'white',
                        display: 'grid', placeItems: 'center',
                      }}>
                        {isSelected && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--navy-800)' }} />}
                      </span>
                      <span>
                        <div style={{
                          fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '14.5px',
                          color: 'var(--ink-900)',
                        }}>{move.english}</div>
                        <div style={{
                          fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12px',
                          color: 'var(--ink-500)', marginTop: 1,
                        }}>{move.pinyin}</div>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePreview(move.slug); }}
                        style={{
                          fontFamily: 'var(--ff-body)', fontSize: '12px',
                          padding: '4px 10px', border: '1px solid var(--ink-200)',
                          borderRadius: '999px', background: 'white', cursor: 'pointer',
                          color: 'var(--ink-700)',
                        }}
                        aria-label={isPreviewing ? `Pause preview for ${move.english}` : `Preview ${move.english}`}
                      >{isPreviewing ? '■' : '▶'} preview</button>
                    </label>
                    {isPreviewing && (
                      <video
                        ref={(el) => { if (el) videoRefs.current.set(move.slug, el); else videoRefs.current.delete(move.slug); }}
                        src={move.mp4_url}
                        muted
                        playsInline
                        loop
                        style={{
                          width: '100%', marginTop: 6,
                          borderRadius: 'var(--r-md)',
                          background: 'black',
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <footer style={{
          padding: '14px 28px',
          borderTop: '1px solid var(--ink-100)',
          display: 'flex', gap: 12, justifyContent: 'flex-end',
        }}>
          <button type="button" onClick={onClose} style={{
            fontFamily: 'var(--ff-body)', fontSize: '14px', padding: '10px 20px',
            border: '1px solid var(--ink-200)', borderRadius: 999,
            background: 'transparent', color: 'var(--ink-700)', cursor: 'pointer',
          }}>Cancel</button>
          <button type="button" onClick={commit} disabled={selected === currentSlug} style={{
            fontFamily: 'var(--ff-body)', fontSize: '14px', padding: '10px 20px',
            border: '1px solid var(--navy-800)', borderRadius: 999,
            background: selected === currentSlug ? 'var(--ink-300)' : 'var(--navy-800)',
            color: 'var(--linen-50)',
            cursor: selected === currentSlug ? 'not-allowed' : 'pointer',
          }}>Select</button>
        </footer>
      </aside>
    </>
  );

  // Portal to document.body to escape any ancestor with `transform` etc.
  // (`.stagger > *` applies transform: translateY(10px), which would
  // otherwise trap our position:fixed sheet inside the carousel card.)
  return createPortal(sheet, document.body);
}
