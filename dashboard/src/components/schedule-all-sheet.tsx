'use client';

import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { scheduleAll } from '@/app/actions/schedule-all';
import { PLATFORMS, PLATFORM_DISPLAY, type Platform } from '@/lib/platforms';

interface ScheduleAllSheetProps {
  videoId: string;
  captions: Partial<Record<Platform, string>>;
  bufferConfigured: boolean;
  /** 'now' renders a "Post now" trigger that opens the sheet pre-toggled
   *  to immediate posting. 'schedule' (default) is the original behavior. */
  mode?: 'now' | 'schedule';
  /** Visual variant for the trigger: solid navy ('primary') or outline. */
  variant?: 'primary' | 'secondary';
  /** When true and shareNow is true, scheduleAll ALSO flips
   *  published_to_website. This prop drives the UI hint that explains
   *  it; the actual flip happens server-side. */
  alreadyPublishedToWebsite?: boolean;
  /** Passed through to scheduleAll for revalidation when site-publish
   *  bundles in. */
  parshaSlug?: string;
  /** Channels actually wired up (Buffer + YouTube). Drives the
   *  channel chip list and the lede count. When undefined, falls back
   *  to all PLATFORMS for backwards-compat (legacy callers). */
  connectedPlatforms?: Platform[];
  /** Optional version label for the sheet header (e.g. "Version 3").
   *  Lets Yonah see which take is going out. */
  versionLabel?: string;
  /** Parsha name for the sheet header. */
  parshaName?: string;
  /** Sibling version that's currently live on the site. When the
   *  bundled site-publish runs (post-now on an unpublished video),
   *  this version will be unpublished. */
  replacing?: { label: string } | null;
  /** Thumbnail of the version being posted. */
  thumbUrl?: string | null;
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

export function ScheduleAllSheet({
  videoId, captions, bufferConfigured, mode = 'schedule', variant = 'primary',
  alreadyPublishedToWebsite, parshaSlug, connectedPlatforms,
  versionLabel, parshaName, replacing, thumbUrl,
}: ScheduleAllSheetProps) {
  const channels: readonly Platform[] = connectedPlatforms ?? PLATFORMS;
  const channelCount = channels.length;
  const defaultDate = nextFriday6pm();
  const [open, setOpen] = useState(false);
  const [notConfiguredOpen, setNotConfiguredOpen] = useState(false);
  const [shareNow, setShareNow] = useState(mode === 'now');
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
    // Re-sync timing toggle to the trigger's mode so reopening from the
    // "Post now" button doesn't inherit a previous "Schedule for later"
    // selection.
    setShareNow(mode === 'now');
    setOpen(true);
  };

  const closeSheet = () => {
    setOpen(false);
  };

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const d = shareNow ? new Date() : new Date(scheduledAt);
      const result = await scheduleAll({
        videoId, scheduledAt: d, captions, shareNow, parshaSlug,
      });
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
      const sitePart = result.alsoPublishedToSite
        ? ' and torahtaichi.com'
        : '';
      setToastMsg(
        shareNow
          ? `Posting to ${count} channel${count !== 1 ? 's' : ''}${sitePart}`
          : `Scheduled to ${count} channel${count !== 1 ? 's' : ''} for ${formatFriendly(d)}`,
      );
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 4000);
    });
  };

  const willPublishSiteToo = (
    shareNow && !alreadyPublishedToWebsite
  );

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
          border: `1px solid ${variant === 'secondary' ? 'var(--ink-200)' : 'var(--navy-800)'}`,
          background: variant === 'secondary' ? 'transparent' : 'var(--navy-800)',
          color: variant === 'secondary' ? 'var(--ink-700)' : 'var(--linen-50)',
          cursor: 'pointer',
          transition: 'all var(--trans)',
          boxShadow: variant === 'secondary'
            ? 'none'
            : '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
        }}
      >
        {mode === 'now' ? 'Post now' : 'Schedule all'}
      </button>

      {typeof document !== 'undefined' && createPortal(
      <>
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
          {versionLabel && parshaName ? (
            <>
              Posting <strong>{versionLabel} of {parshaName}</strong> to{' '}
              {channelCount} connected channel{channelCount === 1 ? '' : 's'}{' '}
              simultaneously.
            </>
          ) : (
            <>
              Will schedule to {channelCount} connected channel
              {channelCount === 1 ? '' : 's'} simultaneously.
            </>
          )}
        </p>

        {/* Timing toggle */}
        <div style={{ marginBottom: '20px' }}>
          <div
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
            Timing
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            {[
              { v: true,  label: 'Post now' },
              { v: false, label: 'Schedule for later' },
            ].map((opt) => (
              <button
                key={String(opt.v)}
                type="button"
                onClick={() => setShareNow(opt.v)}
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontWeight: 500,
                  fontSize: '13px',
                  padding: '9px 16px',
                  minHeight: '40px',
                  borderRadius: '999px',
                  border: `1px solid ${shareNow === opt.v ? 'var(--navy-800)' : 'var(--ink-200)'}`,
                  background: shareNow === opt.v ? 'var(--navy-800)' : 'transparent',
                  color: shareNow === opt.v ? 'var(--linen-50)' : 'var(--ink-700)',
                  cursor: 'pointer',
                  transition: 'all var(--trans)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {shareNow ? (
            <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12.5px', color: 'var(--ink-500)', margin: 0, fontVariationSettings: '"opsz" 14, "SOFT" 50' }}>
              Posts publish immediately to every connected channel.
            </p>
          ) : (
            <>
              <label
                htmlFor="schedule-datetime"
                style={{
                  display: 'block',
                  fontFamily: 'var(--ff-body)',
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-500)',
                  marginBottom: '6px',
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
            </>
          )}
        </div>

        {/* Review: everything that's about to go out. */}
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--linen-50)',
            border: '1px solid var(--ink-100)',
            borderRadius: 'var(--r-md)',
            marginBottom: '20px',
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--ink-700)',
            lineHeight: 1.55,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--ff-body)',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-500)',
              marginBottom: '10px',
            }}
          >
            Review
          </div>

          {/* Header row: thumbnail + version/parsha + replacing notice. */}
          {(versionLabel || thumbUrl || replacing) && (
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
              {thumbUrl && (
                <img
                  src={thumbUrl}
                  alt={versionLabel ? `${versionLabel} thumbnail` : 'video thumbnail'}
                  style={{
                    width: '64px',
                    height: '88px',
                    objectFit: 'cover',
                    borderRadius: '6px',
                    background: 'var(--ink-100)',
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {versionLabel && parshaName && (
                  <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--ink-900)', marginBottom: '4px' }}>
                    {versionLabel} of {parshaName}
                  </div>
                )}
                {replacing && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--ink-700)',
                      padding: '6px 8px',
                      background: 'rgba(180, 130, 0, .08)',
                      border: '1px solid rgba(180, 130, 0, .2)',
                      borderRadius: '4px',
                      marginTop: '4px',
                    }}
                  >
                    Replaces <strong>{replacing.label}</strong> currently live on the site.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Per-channel preview: caption + name. */}
          <div style={{ marginBottom: shareNow && willPublishSiteToo ? '10px' : 0 }}>
            <div
              style={{
                fontSize: '11.5px',
                fontWeight: 500,
                letterSpacing: '0.04em',
                color: 'var(--ink-500)',
                marginBottom: '6px',
              }}
            >
              {shareNow ? 'Posting to' : 'Scheduling to'}{' '}
              {channelCount} channel{channelCount === 1 ? '' : 's'}
            </div>
            {channelCount === 0 ? (
              <p style={{ fontSize: '12.5px', color: 'var(--ink-500)', fontStyle: 'italic', margin: 0 }}>
                No channels connected. Connect at least one in /channels.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {channels.map((p) => {
                  const cap = (captions[p] ?? '').trim();
                  const preview = cap.length > 100 ? `${cap.slice(0, 100).trim()}\u2026` : cap;
                  return (
                    <li
                      key={p}
                      style={{
                        padding: '8px 0',
                        borderTop: '1px solid var(--ink-100)',
                        fontSize: '12.5px',
                      }}
                    >
                      <div style={{ fontWeight: 500, color: 'var(--ink-900)', marginBottom: '2px' }}>
                        {PLATFORM_DISPLAY[p]}
                      </div>
                      <div style={{ color: 'var(--ink-600)', fontStyle: cap ? 'normal' : 'italic' }}>
                        {preview || '(no caption set)'}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Bundled site publish notice — only inside the review when
              it's actually going to fire (post-now AND not yet live). */}
          {shareNow && willPublishSiteToo && (
            <div
              style={{
                padding: '8px 10px',
                border: '1px solid rgba(46,125,94,.25)',
                background: 'rgba(46,125,94,.06)',
                borderRadius: '6px',
                fontSize: '12.5px',
                color: 'var(--ink-700)',
                marginTop: '10px',
              }}
            >
              <strong>Plus:</strong> publishes to torahtaichi.com
              {replacing
                ? ` (unpublishes ${replacing.label} at the same time).`
                : '.'}
            </div>
          )}
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
            {isPending ? (shareNow ? 'Posting…' : 'Scheduling…') : (shareNow ? 'Post now' : 'Schedule')}
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
      </>,
      document.body
      )}
    </>
  );
}
