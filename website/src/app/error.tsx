'use client';

import { useEffect } from 'react';

export default function WebsiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console so it appears in Vercel runtime logs
    console.error('[WebsiteError]', error);
  }, [error]);

  return (
    <div
      style={{
        maxWidth: '680px',
        margin: '80px auto',
        padding: '0 32px',
        fontFamily: 'var(--ff-display, Fraunces, Georgia, serif)',
      }}
    >
      <h1
        style={{
          fontWeight: 400,
          fontSize: '2rem',
          color: 'var(--ink-900, #1a1208)',
          marginBottom: '16px',
        }}
      >
        Something didn&apos;t load.
      </h1>
      <p
        style={{
          fontStyle: 'italic',
          color: 'var(--ink-500, #6b5940)',
          fontSize: '1.1rem',
          marginBottom: '32px',
        }}
      >
        A page failed to render. This is usually a brief connectivity issue — try again.
      </p>
      <button
        onClick={reset}
        style={{
          padding: '11px 28px',
          borderRadius: '999px',
          border: '1px solid var(--ink-200, #d9cbb5)',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: '14px',
          color: 'var(--ink-700, #3d2a14)',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  );
}
