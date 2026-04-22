'use client';

import { useMemo, useState } from 'react';
import { PLACEHOLDER_THUMB_URL } from '@/lib/storage-url';

export interface VideoCard {
  key: string;
  kind: 'parsha' | 'topic';
  title: string;
  href: string;
  jobId: string;
  state: 'in_flight' | 'done' | 'failed' | 'other';
  statusMessage: string;
  triggeredAt: string;
  thumbUrl: string | null;
}

const STATE_LABELS: Record<VideoCard['state'], string> = {
  in_flight: 'Generating',
  done: 'Video ready',
  failed: 'Failed',
  other: '—',
};

const STATE_ORDER: Record<VideoCard['state'], number> = {
  in_flight: 0,
  done: 1,
  failed: 2,
  other: 3,
};

interface Props {
  cards: VideoCard[];
}

export function VideosDashboard({ cards }: Props) {
  const [filter, setFilter] = useState<'all' | VideoCard['state']>('all');

  const tabs: Array<{ id: typeof filter; label: string; count: number }> = useMemo(() => {
    return [
      { id: 'all',       label: 'All',        count: cards.length },
      { id: 'in_flight', label: 'Generating', count: cards.filter((c) => c.state === 'in_flight').length },
      { id: 'done',      label: 'Ready',      count: cards.filter((c) => c.state === 'done').length },
      { id: 'failed',    label: 'Failed',     count: cards.filter((c) => c.state === 'failed').length },
    ];
  }, [cards]);

  const filtered = useMemo(() => {
    const rows = filter === 'all' ? cards : cards.filter((c) => c.state === filter);
    return [...rows].sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        b.triggeredAt.localeCompare(a.triggeredAt)
    );
  }, [cards, filter]);

  if (cards.length === 0) {
    return (
      <div
        style={{
          padding: '48px 32px',
          border: '1px dashed var(--ink-200)',
          borderRadius: 'var(--r-lg)',
          textAlign: 'center',
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '15px',
          color: 'var(--ink-500)',
          lineHeight: 1.6,
          fontVariationSettings: '"opsz" 16, "SOFT" 50',
        }}
      >
        No videos yet. Start one from{' '}
        <a href="/" style={{ color: 'var(--navy-700)' }}>Today</a>,{' '}
        <a href="/parshiot" style={{ color: 'var(--navy-700)' }}>Parshiot</a>, or{' '}
        <a href="/compose" style={{ color: 'var(--navy-700)' }}>Compose</a>.
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '24px' }}>
        {tabs.map((t) => {
          const active = filter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontFamily: 'var(--ff-body)',
                fontSize: '13px',
                fontWeight: 500,
                padding: '8px 16px',
                minHeight: '38px',
                borderRadius: '999px',
                border: `1px solid ${active ? 'var(--navy-800)' : 'var(--ink-200)'}`,
                background: active ? 'var(--navy-800)' : 'transparent',
                color: active ? 'var(--linen-50)' : 'var(--ink-700)',
                cursor: 'pointer',
                transition: 'all var(--trans)',
              }}
            >
              {t.label}
              <span
                style={{
                  fontSize: '11px',
                  color: active ? 'var(--navy-300)' : 'var(--ink-400)',
                  fontVariantNumeric: 'tabular-nums',
                  fontStyle: 'italic',
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '18px',
        }}
        className="video-grid"
      >
        {filtered.map((c) => (
          <VideoCardTile key={c.key} card={c} />
        ))}
      </div>
    </>
  );
}

function VideoCardTile({ card }: { card: VideoCard }) {
  const stateColor =
    card.state === 'in_flight' ? 'var(--navy-700)'
    : card.state === 'done' ? 'var(--jade)'
    : card.state === 'failed' ? 'var(--tassel)'
    : 'var(--ink-300)';
  const stateBg =
    card.state === 'in_flight' ? 'var(--navy-wash)'
    : card.state === 'done' ? 'rgba(46,125,94,.12)'
    : card.state === 'failed' ? 'rgba(192,57,43,.08)'
    : 'var(--ink-100)';

  return (
    <a
      href={card.href}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all var(--trans)',
      }}
      className="video-card"
    >
      <div
        style={{
          aspectRatio: '9 / 16',
          maxHeight: '480px',
          borderRadius: 'var(--r-md)',
          overflow: 'hidden',
          background: `var(--linen-100) url(${card.thumbUrl ?? PLACEHOLDER_THUMB_URL}) center/cover no-repeat`,
          position: 'relative',
        }}
      >
        {card.state === 'in_flight' && (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(35,27,16,.18)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--linen-50)',
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '13px',
            }}
          >
            <span
              style={{
                padding: '6px 14px',
                borderRadius: '999px',
                background: 'rgba(19,30,56,.7)',
                animation: 'pulse-navy 1.8s ease-in-out infinite',
              }}
            >
              Generating…
            </span>
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontSize: '15px',
            fontWeight: 500,
            color: 'var(--ink-900)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
            flex: 1,
          }}
        >
          {card.title}
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 8px',
            borderRadius: '999px',
            border: `1px solid ${stateColor}`,
            background: stateBg,
            color: stateColor,
            fontFamily: 'var(--ff-body)',
            fontSize: '10.5px',
            fontWeight: 600,
            letterSpacing: '0.02em',
            flexShrink: 0,
          }}
        >
          {card.state === 'in_flight' && (
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: stateColor,
                animation: 'pulse-navy 1.8s ease-in-out infinite',
              }}
            />
          )}
          {STATE_LABELS[card.state]}
        </span>
      </div>
    </a>
  );
}
