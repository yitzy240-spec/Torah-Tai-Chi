'use client';

import { useMemo, useState } from 'react';

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
  // Thumb area is one of three things — never both a real thumb AND an
  // overlay state, since that gets visually noisy. Only the done state
  // shows a real thumbnail; in-flight and failed get purpose-built
  // placeholders that match the state's intent.
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
        gap: 10,
        textDecoration: 'none',
        color: 'inherit',
        maxWidth: '360px',  // keep 9:16 cards from going phone-screen-tall on mobile
        width: '100%',
        margin: '0 auto',
        transition: 'all var(--trans)',
      }}
      className="video-card"
    >
      {/* Title above the thumb so the reader sees what they're looking at first. */}
      <div
        style={{
          fontFamily: 'var(--ff-display)',
          fontSize: '17px',
          fontWeight: 500,
          color: 'var(--ink-900)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {card.title}
      </div>
      <div
        style={{
          aspectRatio: '9 / 16',
          borderRadius: 'var(--r-md)',
          overflow: 'hidden',
          position: 'relative',
          background:
            card.state === 'done' && card.thumbUrl
              ? `var(--ink-900) url(${card.thumbUrl}) center/cover no-repeat`
              : card.state === 'failed'
                ? 'linear-gradient(180deg, rgba(192,57,43,.08) 0%, rgba(192,57,43,.18) 100%)'
                : card.state === 'in_flight'
                  ? 'linear-gradient(180deg, var(--navy-wash) 0%, var(--navy-100) 100%)'
                  : 'var(--linen-100)',
        }}
      >
        {card.state === 'in_flight' && <InFlightState message={card.statusMessage} />}
        {card.state === 'failed' && <FailedState />}
        {card.state === 'done' && card.thumbUrl && <PlayBadge />}
      </div>
      {/* Status pill below the thumb — duplicates the visual state but
          gives a clean text label that scans fast in the grid. */}
      <span
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: '999px',
          border: `1px solid ${stateColor}`,
          background: stateBg,
          color: stateColor,
          fontFamily: 'var(--ff-body)',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}
      >
        {card.state === 'in_flight' && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: stateColor,
              animation: 'pulse-navy 1.8s ease-in-out infinite',
            }}
          />
        )}
        {STATE_LABELS[card.state]}
      </span>
    </a>
  );
}

function InFlightState({ message }: { message: string }) {
  return (
    <span
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        textAlign: 'center',
        color: 'var(--navy-800)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'var(--navy-700)',
          animation: 'pulse-navy 1.8s ease-in-out infinite',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '15px',
          fontWeight: 500,
          fontVariationSettings: '"opsz" 16, "SOFT" 50',
        }}
      >
        Generating
      </span>
      <span
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '12.5px',
          color: 'var(--ink-500)',
          fontVariationSettings: '"opsz" 14, "SOFT" 60',
          maxWidth: '14em',
          lineHeight: 1.4,
        }}
      >
        {message}
      </span>
    </span>
  );
}

function FailedState() {
  return (
    <span
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 24,
        color: 'var(--tassel)',
      }}
    >
      <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '15px', fontWeight: 500 }}>
        Generation failed
      </span>
      <span style={{ fontFamily: 'var(--ff-body)', fontSize: '12px' }}>tap to view details</span>
    </span>
  );
}

function PlayBadge() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: 'rgba(35,27,16,.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--linen-50)',
      }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 14, height: 14, marginLeft: 2 }}>
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  );
}
