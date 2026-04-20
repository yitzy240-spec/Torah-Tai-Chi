'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export interface ViewerEvent {
  id: string;
  createdAt: string;
  actor: string;
  level: string;
  event: string;
  subjectType: string | null;
  subjectId: string | null;
  message: string;
  details: Record<string, unknown> | null;
  resolved: boolean;
  /** pre-resolved /videos/<slug> href when subject_type='video' */
  subjectHref: string | null;
}

type Filter = 'all' | 'error' | 'warn' | 'action';

const LEVEL_COLORS: Record<string, string> = {
  info: 'var(--ink-400)',
  warn: '#D4A04C',
  error: '#C2514F',
  action: 'var(--jade, #4B7F6A)',
};

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  error: 'Errors',
  warn: 'Warnings',
  action: 'Actions',
};

/** Rough "N minutes ago" — good enough for a diagnostics table. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function EventsViewer({ events }: { events: ViewerEvent[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter((e) => e.level === filter);
  }, [events, filter]);

  const handleCopy = async () => {
    const bundle = events.slice(0, 50).map((e) => ({
      created_at: e.createdAt,
      actor: e.actor,
      level: e.level,
      event: e.event,
      subject_type: e.subjectType,
      subject_id: e.subjectId,
      message: e.message,
      details: e.details,
    }));
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 2500);
    }
  };

  return (
    <div>
      {/* Filter chips + copy bundle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '16px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--ink-100)',
        }}
      >
        {(['all', 'error', 'warn', 'action'] as Filter[]).map((f) => {
          const active = filter === f;
          return (
            <button
              type="button"
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontFamily: 'var(--ff-display)',
                fontSize: '13px',
                padding: '6px 14px',
                borderRadius: '999px',
                border: active ? '1px solid var(--navy-800)' : '1px solid var(--ink-200)',
                background: active ? 'var(--navy-800)' : 'transparent',
                color: active ? 'var(--linen-50)' : 'var(--ink-700)',
                cursor: 'pointer',
                transition: 'all var(--trans)',
              }}
            >
              {FILTER_LABELS[f]}
            </button>
          );
        })}

        <div style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            onClick={handleCopy}
            style={{
              fontFamily: 'var(--ff-display)',
              fontSize: '13px',
              padding: '6px 14px',
              borderRadius: '999px',
              border: '1px solid var(--ink-200)',
              background: 'transparent',
              color: 'var(--ink-700)',
              cursor: 'pointer',
            }}
          >
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy last 50 as diagnostic bundle'}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '14px',
            color: 'var(--ink-500)',
            padding: '32px 0',
          }}
        >
          No events match this filter.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {filtered.map((e) => {
            const isOpen = !!expanded[e.id];
            const dotColor = LEVEL_COLORS[e.level] ?? 'var(--ink-400)';
            return (
              <li
                key={e.id}
                style={{
                  borderBottom: '1px solid var(--ink-100)',
                  padding: '14px 0',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '16px 120px 100px 1fr',
                    gap: '12px',
                    alignItems: 'baseline',
                  }}
                >
                  {/* Level dot */}
                  <span
                    title={e.level}
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: dotColor,
                      alignSelf: 'center',
                      justifySelf: 'center',
                    }}
                  />

                  {/* Timestamp */}
                  <span
                    title={e.createdAt}
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                      fontSize: '13px',
                      color: 'var(--ink-500)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {relativeTime(e.createdAt)}
                  </span>

                  {/* Actor */}
                  <span
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontSize: '12px',
                      color: 'var(--ink-700)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {e.actor}
                  </span>

                  {/* Event + message */}
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '10px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <code
                        style={{
                          fontFamily: 'var(--ff-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                          fontSize: '12.5px',
                          color: 'var(--ink-900)',
                          background: 'var(--ink-50, #f4efe4)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {e.event}
                      </code>
                      {e.subjectHref ? (
                        <Link
                          href={e.subjectHref}
                          style={{
                            fontFamily: 'var(--ff-display)',
                            fontSize: '12px',
                            fontStyle: 'italic',
                            color: 'var(--navy-700, #2B3A5C)',
                          }}
                        >
                          view {e.subjectType}
                        </Link>
                      ) : e.subjectType && e.subjectId ? (
                        <span
                          title={e.subjectId}
                          style={{
                            fontFamily: 'var(--ff-display)',
                            fontStyle: 'italic',
                            fontSize: '12px',
                            color: 'var(--ink-400)',
                          }}
                        >
                          {e.subjectType}
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--ff-display)',
                        fontSize: '14px',
                        color: 'var(--ink-800)',
                        marginTop: '4px',
                        lineHeight: 1.45,
                      }}
                    >
                      {e.message}
                    </div>

                    {e.details && Object.keys(e.details).length > 0 && (
                      <div style={{ marginTop: '6px' }}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [e.id]: !prev[e.id] }))
                          }
                          style={{
                            fontFamily: 'var(--ff-display)',
                            fontSize: '12px',
                            fontStyle: 'italic',
                            color: 'var(--ink-500)',
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                          }}
                        >
                          {isOpen ? 'Hide details' : 'Show details'}
                        </button>
                        {isOpen && (
                          <pre
                            style={{
                              marginTop: '8px',
                              padding: '10px 12px',
                              background: 'var(--ink-50, #f4efe4)',
                              borderRadius: '6px',
                              fontFamily: 'var(--ff-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                              fontSize: '11.5px',
                              color: 'var(--ink-800)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              maxHeight: '320px',
                              overflow: 'auto',
                              margin: '8px 0 0 0',
                            }}
                          >
                            {JSON.stringify(e.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
