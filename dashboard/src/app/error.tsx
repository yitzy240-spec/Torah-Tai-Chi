'use client';

import { useEffect, useState } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[DashboardError]', error);
  }, [error]);

  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        maxWidth: '680px',
        margin: '64px auto',
        padding: '48px 56px',
        background: 'var(--linen-50)',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-xl)',
        fontFamily: 'var(--ff-display)',
      }}
    >
      <h2
        style={{
          fontWeight: 400,
          fontSize: '1.75rem',
          color: 'var(--ink-900)',
          marginBottom: '14px',
          fontVariationSettings: '"opsz" 36, "SOFT" 20',
        }}
      >
        Something didn&apos;t load.
      </h2>
      <p
        style={{
          fontStyle: 'italic',
          color: 'var(--ink-500)',
          marginBottom: '32px',
          fontSize: '1rem',
          fontVariationSettings: '"opsz" 18, "SOFT" 50',
        }}
      >
        A page failed to render — usually a brief network hiccup. Try again or refresh.
      </p>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '28px' }}>
        <button
          onClick={reset}
          style={{
            padding: '10px 24px',
            borderRadius: '999px',
            border: '1px solid var(--navy-800)',
            background: 'var(--navy-800)',
            color: 'var(--linen-50)',
            fontFamily: 'var(--ff-body)',
            fontSize: '13.5px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 24px',
            borderRadius: '999px',
            border: '1px solid var(--ink-200)',
            background: 'transparent',
            color: 'var(--ink-700)',
            fontFamily: 'var(--ff-body)',
            fontSize: '13.5px',
            cursor: 'pointer',
          }}
        >
          Reload page
        </button>
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '12px',
          color: 'var(--ink-400)',
          cursor: 'pointer',
          padding: 0,
          textDecoration: 'underline',
          textDecorationColor: 'var(--ink-200)',
          textUnderlineOffset: '3px',
        }}
      >
        {open ? 'Hide details' : 'What happened?'}
      </button>

      {open && (
        <pre
          style={{
            marginTop: '12px',
            padding: '14px 18px',
            background: 'rgba(0,0,0,.03)',
            border: '1px solid var(--ink-100)',
            borderRadius: 'var(--r-md)',
            fontSize: '11px',
            color: 'var(--ink-600)',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '200px',
            overflow: 'auto',
          }}
        >
          {error.message}
          {error.digest ? `\n\nDigest: ${error.digest}` : ''}
        </pre>
      )}
    </div>
  );
}
