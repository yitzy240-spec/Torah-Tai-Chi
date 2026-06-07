'use client';
import type { ReactNode } from 'react';

interface Props {
  platformName: string;          // e.g. "X", "Facebook", "YouTube"
  icon: ReactNode;                // <PlatformIcon name="..." size={14} />
  scheduledAt: string | null;     // ISO date string
  bufferUpdateId: string | null;  // null = "Open queue" link, else "Edit/cancel" deep link
  /** Deep-link URL builder for when bufferUpdateId is present. */
  externalEditUrl: (bufferId: string) => string;
  /** Fallback URL when no bufferUpdateId. */
  externalListUrl: string;
  /** Label text for the deep-link CTA, e.g. "Edit or cancel in Buffer →". */
  editLabel?: string;
  /** Label for the fallback CTA when no bufferId, e.g. "Open Buffer queue to cancel →". */
  listLabel?: string;
}

export function ScheduledStateCard({
  platformName,
  icon,
  scheduledAt,
  bufferUpdateId,
  externalEditUrl,
  externalListUrl,
  editLabel = 'Edit or cancel in Buffer →',
  listLabel = 'Open Buffer queue to cancel →',
}: Props) {
  return (
    <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon} {platformName} · Scheduled
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>
        Scheduled for {scheduledAt ? new Date(scheduledAt).toLocaleString() : 'unknown'}
      </div>
      {bufferUpdateId ? (
        <a
          href={externalEditUrl(bufferUpdateId)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: 'var(--navy-700)', textDecoration: 'underline' }}
        >
          {editLabel}
        </a>
      ) : (
        <a
          href={externalListUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: 'var(--ink-600)', textDecoration: 'underline' }}
        >
          {listLabel}
        </a>
      )}
    </div>
  );
}
