'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface TooltipProps {
  /** Short explanatory text shown in the popover. */
  text: string;
  /** Optional /help/* path the bottom CTA links to. */
  helpHref?: string;
  /** Optional custom CTA label; defaults to "Learn more →". */
  helpLabel?: string;
  /** Visual size of the trigger circle. Defaults to 14px. */
  size?: number;
  /** Override the inline-color of the trigger. */
  color?: string;
}

/**
 * Tiny "i" badge that reveals a short explanatory popover on hover (desktop)
 * or click (mobile). When helpHref is set, the popover ends with a link
 * back to the matching /help page so the long-form copy stays one click
 * away — keeps tooltip text scannable.
 */
export function Tooltip({
  text,
  helpHref,
  helpLabel = 'Learn more',
  size = 14,
  color = 'var(--ink-400)',
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // Click-outside to dismiss when the user opened it via tap.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <span
      ref={wrapRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
        marginLeft: '6px',
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="More info"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          border: `1px solid ${color}`,
          background: 'transparent',
          color,
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontWeight: 500,
          fontSize: `${Math.round(size * 0.72)}px`,
          lineHeight: 1,
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all var(--trans)',
          opacity: 0.7,
        }}
        className="tooltip-trigger"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 50,
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(280px, 80vw)',
            padding: '12px 14px',
            background: 'var(--ink-900)',
            color: 'var(--linen-50)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 12px 28px -12px rgba(35,27,16,.45)',
            fontFamily: 'var(--ff-body)',
            fontStyle: 'normal',
            fontSize: '12.5px',
            lineHeight: 1.5,
            letterSpacing: 'normal',
            textTransform: 'none',
            textAlign: 'left',
          }}
        >
          {text}
          {helpHref && (
            <span style={{ display: 'block', marginTop: '8px' }}>
              <Link
                href={helpHref}
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: 'var(--linen-50)',
                  fontSize: '12px',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                  textDecorationColor: 'rgba(245,236,222,.4)',
                }}
              >
                {helpLabel} →
              </Link>
            </span>
          )}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid var(--ink-900)',
            }}
          />
        </span>
      )}
    </span>
  );
}
