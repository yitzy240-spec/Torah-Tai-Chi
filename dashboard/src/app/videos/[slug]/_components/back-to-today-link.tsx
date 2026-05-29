// dashboard/src/app/videos/[slug]/_components/back-to-today-link.tsx
//
// Persistent "← Today" link rendered at the top of every video editor
// page state. Added 2026-05-29 after Yonah flagged: when a phase
// breaks (e.g., regen didn't catch a new script), the state-driven UI
// has no escape route — the operator can't get back to the dashboard
// landing without typing the URL manually or hitting the browser back
// button (which may not work if the user just landed via redirect).
//
// Server component — pure render, no client state needed.

import Link from 'next/link';

export function BackToTodayLink() {
  return (
    <div style={{ marginBottom: 14 }}>
      <Link
        href="/"
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: '13px',
          color: 'var(--ink-500)',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '6px 4px',
          borderRadius: '4px',
          transition: 'color var(--trans)',
          minHeight: '32px',
        }}
        className="back-to-today-link"
      >
        <span aria-hidden="true">←</span>
        <span>Today</span>
      </Link>
    </div>
  );
}
