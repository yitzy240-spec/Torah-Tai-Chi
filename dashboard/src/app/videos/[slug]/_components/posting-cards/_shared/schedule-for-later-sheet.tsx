// dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/schedule-for-later-sheet.tsx
//
// Bottom sheet with native <input type="datetime-local"> for scheduling a post.
// On submit calls postToPlatform with { scheduledAt, shareNow: false }.
// Cancel stub: // TODO: cancel scheduled post — out of scope for M5.

'use client';
import { useState } from 'react';
import { BottomSheet } from '../../bottom-sheet';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: string;       // display name e.g. "TikTok"
  onSchedule: (when: Date) => Promise<void>;
}

export function ScheduleForLaterSheet({ open, onOpenChange, platform, onSchedule }: Props) {
  const [when, setWhen] = useState<string>(defaultDatetimeLocal());
  const [pending, setPending] = useState(false);

  async function handleSchedule() {
    if (!when) return;
    setPending(true);
    try {
      await onSchedule(new Date(when));
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Schedule for ${platform}`}
      primaryAction={{
        label: pending ? 'Scheduling…' : 'Schedule',
        onClick: handleSchedule,
      }}
      secondaryAction={{ label: 'Cancel', onClick: () => onOpenChange(false) }}
    >
      <div>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-700)', marginBottom: 6 }}>
          When to post
        </label>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          style={{
            width: '100%',
            minHeight: 44,
            fontSize: 16,
            padding: '8px 10px',
            border: '1px solid var(--ink-100)',
            borderRadius: 6,
            boxSizing: 'border-box',
          }}
        />
      </div>
    </BottomSheet>
  );
}

function defaultDatetimeLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
