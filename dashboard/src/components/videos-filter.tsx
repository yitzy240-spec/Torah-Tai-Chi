'use client';

import { useState } from 'react';

const BOOKS = ['All', 'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'];

const PLACEHOLDER_THUMB =
  'https://jswdfthmegjbhnwbgeca.supabase.co/storage/v1/object/public/videos/placeholders/video_placeholder.png';

interface Parsha {
  id: string;
  order: number;
  name: string;
  book: string;
  slug: string;
  name_hebrew?: string | null;
  scripts: { option: string; draft_text: string | null }[];
  thumbUrl?: string | null;
}

interface VideosFilterProps {
  parshiot: Parsha[];
}

function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

type StatusType = 'published' | 'video-ready' | 'script-ready' | 'not-started';

function getStatus(parsha: Parsha): StatusType {
  const aTight = parsha.scripts?.find((s) => s.option === 'A-tight');
  if (aTight) return 'script-ready';
  return 'not-started';
}

const STATUS_LABELS: Record<StatusType, string> = {
  'published': 'Published',
  'video-ready': 'Video ready',
  'script-ready': 'Script ready',
  'not-started': 'Not started',
};

export function VideosFilter({ parshiot }: VideosFilterProps) {
  const [activeBook, setActiveBook] = useState('All');

  const filtered = activeBook === 'All'
    ? parshiot
    : parshiot.filter((p) => p.book === activeBook);

  return (
    <>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '28px' }}>
        {BOOKS.map((book) => {
          const active = activeBook === book;
          return (
            <button
              key={book}
              type="button"
              onClick={() => setActiveBook(book)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                fontFamily: 'var(--ff-body)',
                fontSize: '13px',
                fontWeight: 500,
                padding: '9px 18px',
                minHeight: '44px',
                borderRadius: '999px',
                border: `1px solid ${active ? 'var(--navy-800)' : 'var(--ink-200)'}`,
                background: active ? 'var(--navy-800)' : 'transparent',
                color: active ? 'var(--linen-50)' : 'var(--ink-700)',
                cursor: 'pointer',
                transition: 'all var(--trans)',
              }}
            >
              {book}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '14px',
        }}
        className="video-grid"
      >
        {filtered.map((parsha) => {
          const aTight = parsha.scripts?.find((s) => s.option === 'A-tight');
          const status = getStatus(parsha);
          const words = wordCount(aTight?.draft_text);

          return (
            <a
              key={parsha.id}
              href={`/videos/${parsha.slug}`}
              style={{
                padding: '0',
                border: '1px solid var(--ink-100)',
                borderRadius: 'var(--r-lg)',
                background: 'var(--linen-50)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0',
                transition: 'all var(--trans)',
                cursor: 'pointer',
                textDecoration: 'none',
                color: 'inherit',
                overflow: 'hidden',
              }}
              className="v-card"
            >
              {/* Feature B: Thumbnail strip */}
              <div
                style={{
                  width: '100%',
                  aspectRatio: '16 / 9',
                  background: 'var(--ink-100)',
                  overflow: 'hidden',
                  flexShrink: 0,
                  position: 'relative',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={parsha.thumbUrl ?? PLACEHOLDER_THUMB}
                  alt=""
                  aria-hidden="true"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_THUMB;
                  }}
                />
              </div>
              {/* Card body */}
              <div style={{ padding: '16px 20px 18px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
              {/* Top: Hebrew + book */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div
                  lang="he"
                  dir="rtl"
                  style={{
                    fontFamily: 'var(--ff-hebrew)',
                    fontSize: '22px',
                    color: 'var(--ink-700)',
                    direction: 'rtl',
                    textAlign: 'right',
                    lineHeight: 1.1,
                  }}
                >
                  {parsha.name_hebrew ?? ''}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ff-body)',
                    fontSize: '10.5px',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-400)',
                  }}
                >
                  {parsha.book}
                </div>
              </div>

              {/* English name */}
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontWeight: 500,
                  fontSize: '20px',
                  letterSpacing: '-0.015em',
                  color: 'var(--ink-900)',
                  lineHeight: 1.15,
                  fontVariationSettings: '"opsz" 36, "SOFT" 30',
                }}
              >
                {parsha.name}
              </div>

              {/* Meta footer */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginTop: 'auto',
                  paddingTop: '10px',
                  borderTop: '1px dotted var(--ink-100)',
                  fontSize: '12px',
                  color: 'var(--ink-500)',
                }}
              >
                <StatusPill status={status} />
                {words > 0 && (
                  <span
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                      fontSize: '12px',
                      color: 'var(--ink-400)',
                      fontVariationSettings: '"opsz" 14, "SOFT" 50',
                    }}
                  >
                    {words} words
                  </span>
                )}
              </div>
              </div>{/* end card body */}
            </a>
          );
        })}

        {filtered.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '60px 0',
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '16px',
              color: 'var(--ink-400)',
            }}
          >
            No parshiot in {activeBook} yet.
          </div>
        )}
      </div>
    </>
  );
}

function StatusPill({ status }: { status: StatusType }) {
  const configs: Record<StatusType, { bg: string; color: string; dot: string }> = {
    published:    { bg: 'rgba(90,110,61,.1)',    color: 'var(--jade)',     dot: 'var(--jade)' },
    'video-ready':{ bg: 'var(--navy-wash)',       color: 'var(--navy-700)',dot: 'var(--navy-700)' },
    'script-ready':{ bg: 'rgba(168,114,47,.1)',  color: 'var(--cedar-700)',dot: 'var(--cedar-500)' },
    'not-started':{ bg: 'rgba(140,125,100,.08)', color: 'var(--ink-400)', dot: 'var(--ink-300)' },
  };
  const cfg = configs[status];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontFamily: 'var(--ff-body)',
        fontSize: '11.5px',
        fontWeight: 500,
        padding: '4px 12px 4px 8px',
        borderRadius: '999px',
        letterSpacing: '0.01em',
        background: cfg.bg,
        color: cfg.color,
      }}
    >
      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
      {STATUS_LABELS[status]}
    </span>
  );
}
