'use client';

import { useEffect } from 'react';

// Outermost error boundary — catches layout-level failures.
// Must include <html> and <body> since it replaces the root layout.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'Georgia, serif',
          background: '#faf4e8',
          color: '#1a1208',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '32px',
        }}
      >
        <div style={{ maxWidth: '520px', textAlign: 'center' }}>
          <h1 style={{ fontWeight: 400, marginBottom: '16px', fontSize: '1.8rem' }}>
            Something went wrong.
          </h1>
          <p style={{ fontStyle: 'italic', color: '#6b5940', marginBottom: '32px' }}>
            The dashboard encountered an unexpected error. Reload the page or try again in a moment.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '11px 28px',
              borderRadius: '999px',
              border: '1px solid #1d2d4f',
              background: '#1d2d4f',
              color: '#faf4e8',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
