'use client';

import { useEffect, useState, useTransition } from 'react';
import { scheduleAll } from '@/app/actions/schedule-all';

const PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook'] as const;
type Platform = typeof PLATFORMS[number];

interface ScheduleAllSheetProps {
  videoId: string;
  captions: Partial<Record<Platform, string>>;
  bufferConfigured: boolean;
}

/** Returns the next Friday at 18:00 local time */
function nextFriday6pm(): Date {
  const d = new Date();
  const day = d.getDay(); // 0=Sun … 5=Fri
  const daysUntilFri = (5 - day + 7) % 7 || 7; // always go forward
  d.setDate(d.getDate() + daysUntilFri);
  d.setHours(18, 0, 0, 0);
  return d;
}

function formatDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatFriendly(d: Date): string {
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = d.getHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return `${dayNames[d.getDay()]} ${monthNames[d.getMonth()]} ${d.getDate()} at ${h12}:${String(d.getMinutes()).padStart(2,'0')}${ampm}`;
}

export function ScheduleAllSheet({ videoId, captions, bufferConfigured }: ScheduleAllSheetProps) {
  const defaultDate = nextFriday6pm();
  const [open, setOpen] = useState(false);
  const [notConfiguredOpen, setNotConfiguredOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(formatDatetimeLocal(defaultDate));
  const [isPending, startTransition] = useTransition();
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const openSheet = () => {
    if (!bufferConfigured) {
      setNotConfiguredOpen(true);
      return;
    }
    setError(null);
    setOpen(true);
  };

  const closeSheet = () => {
    setOpen(false);
  };

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const d = new Date(scheduledAt);
      const result = await scheduleAll({ videoId, scheduledAt: d, captions });
      if (result.error === 'BUFFER_NOT_CONFIGURED') {
        closeSheet();
        setNotConfiguredOpen(true);
        return;
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      closeSheet();
      const count = result.results?.length ?? 0;
      setToastMsg(`Scheduled to ${count} channel${count !== 1 ? 's' : ''} for ${formatFriendly(d)}`);
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 4000);
    });
  };

  const scheduledDate = new Date(scheduledAt);

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={openSheet}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'var(--ff-body)',
          fontWeight: 500,
          fontSize: '14px',
          padding: '11px 22px',
          minHeight: '44px',
          borderRadius: '999px',
          border: '1px solid var(--navy-800)',
          background: 'var(--navy-800)',
          color: 'var(--linen-50)',
          cursor: 'pointer',
          transition: 'all var(--trans)',
          boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
        }}
      >
        Schedule all
      </button>

      {/* "Buffer not configured" modal */}
      {notConfiguredOpen && (
        <>
          <div
            onClick={() => setNotConfiguredOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(35,27,16,.38)', backdropFilter: 'blur(4px)' }}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed', zIndex: 31, left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(440px, calc(100vw - 32px))',
              background: 'var(--linen-50)',
              border: '1px solid var(--ink-200)',
              borderRadius: 'var(--r-xl)',
              boxShadow: '0 30px 80px -30px rgba(35,27,16,.45)',
              padding: '36px 40px 32px',
            }}
          >
            <h2 style={{ fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: '24px', margin: '0 0 10px 0', color: 'var(--ink-900)', fontVariationSettings: '"opsz" 36, "SOFT" 30' }}>
              Connect Buffer to schedule posts
            </h2>
            <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '14px', color: 'var(--ink-500)', margin: '0 0 20px 0', fontVariationSettings: '"opsz" 14, "SOFT" 50', lineHeight: 1.55 }}>
              Add your <code style={{ fontStyle: 'normal', fontSize: '13px', background: 'var(--ink-100)', padding: '2px 6px', borderRadius: '4px' }}>BUFFER_ACCESS_TOKEN</code> to <code style={{ fontStyle: 'normal', fontSize: '13px', background: 'var(--ink-100)', padding: '2px 6px', borderRadius: '4px' }}>.env</code> to enable scheduling.
              See <strong style={{ fontStyle: 'normal', fontWeight: 500, color: 'var(--ink-700)' }}>docs/buffer-setup.md</strong> for instructions.
            </p>
            <button
              type="button"
              onClick={() => setNotConfiguredOpen(false)}
              style={{
                display: 'inline-flex', alignItems: 'center', fontFamily: 'var(--ff-body)', fontWeight: 500,
                fontSize: '14px', padding: '11px 22px', minHeight: '44px', borderRadius: '999px',
                border: '1px solid var(--ink-200)', background: 'transparent', color: 'var(--ink-700)',
                cursor: 'pointer', transition: 'all var(--trans)',
              }}
            >
              Got it
            </button>
          </div>
        </>
      )}

      {/* Schedule sheet scrim */}
      {open && (
        <div
          onClick={closeSheet}
          style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(35,27,16,.38)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          aria-hidden="true"
        />
      )}

      {/* Schedule sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-sheet-title"
        style={{
          position: 'fixed', zIndex: 31, left: '50%', top: '50%',
          transform: open ? 'translate(-50%, -50%)' : 'translate(-50%, calc(-50% + 20px))',
          width: 'min(480px, calc(100vw - 32px))',
          background: 'var(--linen-50)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-xl)',
          boxShadow: '0 30px 80px -30px rgba(35,27,16,.45)',
          padding: '36px 40px 32px',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity var(--trans), transform var(--trans)',
        }}
      >
        <h2
          id="schedule-sheet-title"
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(22px, 3vw, 28px)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: '0 0 8px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 36, "SOFT" 30',
          }}
        >
          When should this ship
          <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 36, "SOFT" 60' }}>?</em>
        </h2>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13.5px',
            color: 'var(--ink-500)',
            margin: '0 0 24px 0',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          Will schedule to all 4 connected channels simultaneously.
        </p>

        {/* Date/time picker */}
        <div style={{ marginBottom: '20px' }}>
          <label
            htmlFor="schedule-datetime"
            style={{
              display: 'block',
              fontFamily: 'var(--ff-display)',
              fontWeight: 500,
              fontSize: '14px',
              color: 'var(--ink-700)',
              marginBottom: '8px',
              fontVariationSettings: '"opsz" 14, "SOFT" 30',
            }}
          >
            Publish time
          </label>
          <input
            id="schedule-datetime"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 14px',
              border: '1px solid var(--ink-200)',
              borderRadius: 'var(--r-md)',
              background: 'var(--linen-50)',
              fontFamily: 'var(--ff-body)',
              fontSize: '15px',
              color: 'var(--ink-900)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <p
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '12.5px',
              color: 'var(--ink-400)',
              margin: '8px 0 0 0',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
            }}
          >
            {formatFriendly(isNaN(scheduledDate.getTime()) ? defaultDate : scheduledDate)}
          </p>
        </div>

        {/* Platforms summary */}
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--ink-100)',
            borderRadius: 'var(--r-md)',
            marginBottom: '20px',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13px',
            color: 'var(--ink-600)',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
            lineHeight: 1.55,
          }}
        >
          TikTok · Instagram · YouTube · Facebook
        </div>

        {error && (
          <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--tassel)', marginBottom: '16px' }}>
            {error}
          </p>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '20px', borderTop: '1px solid var(--ink-100)' }}>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeSheet}
            disabled={isPending}
            style={{
              display: 'inline-flex', alignItems: 'center', fontFamily: 'var(--ff-body)', fontWeight: 500,
              fontSize: '14px', padding: '11px 22px', minHeight: '44px', borderRadius: '999px',
              border: '1px solid var(--ink-200)', background: 'transparent', color: 'var(--ink-700)',
              cursor: 'pointer', transition: 'all var(--trans)', opacity: isPending ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={isPending}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              fontFamily: 'var(--ff-body)', fontWeight: 500, fontSize: '14px',
              padding: '11px 22px', minHeight: '44px', borderRadius: '999px',
              border: '1px solid var(--navy-800)', background: 'var(--navy-800)',
              color: 'var(--linen-50)', cursor: isPending ? 'wait' : 'pointer',
              transition: 'all var(--trans)', opacity: isPending ? 0.7 : 1,
              boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
            }}
          >
            {isPending ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>

      {/* Toast */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed', zIndex: 40, bottom: '28px', left: '50%',
          transform: toastVisible ? 'translate(-50%, 0)' : 'translate(-50%, 40px)',
          padding: '12px 20px 12px 16px',
          background: 'var(--ink-900)', color: 'var(--linen-50)',
          borderRadius: '999px', fontFamily: 'var(--ff-body)', fontSize: '13.5px',
          display: 'flex', alignItems: 'center', gap: '10px',
          opacity: toastVisible ? 1 : 0, pointerEvents: 'none',
          transition: 'all var(--trans)',
          boxShadow: '0 20px 40px -20px rgba(35,27,16,.4)',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'var(--jade)', display: 'grid', placeItems: 'center', color: 'var(--linen-50)', flexShrink: 0 }}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: '10px', height: '10px' }}>
            <path d="M2.5 6.2l2.4 2.3 4.6-4.8"/>
          </svg>
        </span>
        <span>{toastMsg}</span>
      </div>
    </>
  );
}
