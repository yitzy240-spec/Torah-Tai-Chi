'use client';

import { useState } from 'react';

export interface ViewerMessage {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  message: string;
  sentViaEmail: boolean;
  ip: string | null;
}

/** Rough "N minutes ago" — good enough for an admin list. */
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

function snippet(text: string, max = 140): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + '…';
}

export function MessagesViewer({ messages }: { messages: ViewerMessage[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (messages.length === 0) {
    return (
      <div
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '14px',
          color: 'var(--ink-500)',
          padding: '32px 0',
        }}
      >
        Nothing has come through the contact form yet.
      </div>
    );
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {messages.map((m) => {
        const isOpen = !!expanded[m.id];
        return (
          <li
            key={m.id}
            style={{
              borderBottom: '1px solid var(--ink-100)',
              padding: '14px 0',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr auto',
                gap: '14px',
                alignItems: 'baseline',
              }}
              className="messages-row"
            >
              {/* Timestamp */}
              <span
                title={m.createdAt}
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '13px',
                  color: 'var(--ink-500)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {relativeTime(m.createdAt)}
              </span>

              {/* Name + email + snippet */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontWeight: 500,
                      fontSize: '15px',
                      color: 'var(--ink-900)',
                    }}
                  >
                    {m.name}
                  </span>
                  <a
                    href={`mailto:${m.email}`}
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                      fontSize: '13px',
                      color: 'var(--navy-700, #2B3A5C)',
                      textDecoration: 'none',
                    }}
                  >
                    {m.email}
                  </a>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontSize: '14px',
                    color: 'var(--ink-700)',
                    marginTop: '4px',
                    lineHeight: 1.45,
                  }}
                >
                  {isOpen ? (
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        margin: 0,
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        color: 'var(--ink-800)',
                      }}
                    >
                      {m.message}
                    </pre>
                  ) : (
                    snippet(m.message)
                  )}
                </div>

                {isOpen && m.ip && (
                  <div
                    style={{
                      marginTop: '8px',
                      fontFamily:
                        'var(--ff-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                      fontSize: '11.5px',
                      color: 'var(--ink-400)',
                    }}
                  >
                    ip: {m.ip}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginTop: '8px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [m.id]: !isOpen }))
                    }
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontSize: '12px',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      border: '1px solid var(--ink-200)',
                      background: 'transparent',
                      color: 'var(--ink-700)',
                      cursor: 'pointer',
                    }}
                  >
                    {isOpen ? 'Hide' : 'View'}
                  </button>
                </div>
              </div>

              {/* Email status pill */}
              <span
                title={
                  m.sentViaEmail
                    ? 'Email was delivered via Resend'
                    : 'Stored only — Resend not configured yet'
                }
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontSize: '11px',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  padding: '3px 9px',
                  borderRadius: '999px',
                  border: '1px solid',
                  borderColor: m.sentViaEmail
                    ? 'var(--jade, #4B7F6A)'
                    : 'var(--ink-200)',
                  color: m.sentViaEmail
                    ? 'var(--jade, #4B7F6A)'
                    : 'var(--ink-500)',
                  whiteSpace: 'nowrap',
                  alignSelf: 'start',
                }}
              >
                {m.sentViaEmail ? 'emailed' : 'stored'}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
