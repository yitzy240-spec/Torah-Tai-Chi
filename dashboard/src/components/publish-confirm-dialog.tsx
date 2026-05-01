'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface PublishConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** "Version 3" or "Latest" or similar. Shown bold in the body. */
  versionLabel: string;
  /** "Emor", "Vayikra", etc. */
  parshaName: string;
  /** When a sibling version is currently published, describe it so
   *  the user knows it'll be replaced. */
  replacing?: { label: string } | null;
  /** Optional thumbnail for the version being published. */
  thumbUrl?: string | null;
  /** Disable the confirm button (e.g. while the action is pending). */
  pending?: boolean;
}

/**
 * Modal that summarizes a publish-to-site action and asks the user to
 * confirm. Renders nothing when `open` is false. Designed to be
 * controlled — parent owns open state and calls onConfirm/onCancel.
 *
 * Yonah needs to be confident about what's going live. Showing the
 * version, parsha, what's getting replaced, and a thumbnail gives him
 * one place to review before clicking through.
 */
export function PublishConfirmDialog({
  open, onCancel, onConfirm, versionLabel, parshaName,
  replacing, thumbUrl, pending,
}: PublishConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Publish ${versionLabel} of ${parshaName}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(20, 18, 14, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--linen-50, #f8f6ef)',
          borderRadius: '12px',
          maxWidth: '480px',
          width: '100%',
          padding: '24px',
          fontFamily: 'var(--ff-body)',
          boxShadow: '0 20px 40px rgba(0,0,0,.18)',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 500,
          fontSize: '18px',
          margin: '0 0 8px 0',
          color: 'var(--ink-900)',
        }}>
          Publish to torahtaichi.com?
        </h2>
        <p style={{
          fontSize: '14px',
          color: 'var(--ink-700)',
          lineHeight: 1.5,
          margin: '0 0 16px 0',
        }}>
          You&rsquo;re about to make <strong>{versionLabel} of {parshaName}</strong> live
          on the public website. Anyone visiting the site will see this video.
        </p>

        {thumbUrl && (
          <div style={{
            margin: '0 0 16px 0',
            borderRadius: '8px',
            overflow: 'hidden',
            background: 'var(--ink-100)',
            aspectRatio: '9/16',
            maxHeight: '180px',
          }}>
            <img
              src={thumbUrl}
              alt={`${versionLabel} thumbnail`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}

        {replacing && (
          <div style={{
            padding: '10px 12px',
            border: '1px solid rgba(180, 130, 0, .25)',
            background: 'rgba(180, 130, 0, .06)',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '13px',
            color: 'var(--ink-700)',
          }}>
            <strong>Replaces {replacing.label}</strong> &mdash; the version
            currently live for {parshaName} will be unpublished automatically.
          </div>
        )}

        <div style={{
          display: 'flex', gap: '10px', justifyContent: 'flex-end',
          marginTop: '8px',
        }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            style={{
              fontFamily: 'var(--ff-body)',
              fontSize: '13px',
              padding: '9px 18px',
              minHeight: '40px',
              borderRadius: '999px',
              border: '1px solid var(--ink-200)',
              background: 'transparent',
              color: 'var(--ink-700)',
              cursor: pending ? 'wait' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            style={{
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: '13px',
              padding: '9px 22px',
              minHeight: '40px',
              borderRadius: '999px',
              border: '1px solid var(--navy-800)',
              background: 'var(--navy-800)',
              color: 'var(--linen-50)',
              cursor: pending ? 'wait' : 'pointer',
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? 'Publishing\u2026' : 'Publish to site'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
