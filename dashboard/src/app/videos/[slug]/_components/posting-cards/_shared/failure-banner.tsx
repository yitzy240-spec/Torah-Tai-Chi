'use client';

interface Props {
  errorMessage: string | null;
}

export function FailureBanner({ errorMessage }: Props) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '10px 12px',
        marginBottom: 10,
        background: 'rgba(207, 109, 81, 0.08)',
        border: '1px solid var(--tassel)',
        borderRadius: 6,
        fontSize: 12.5,
        color: 'var(--ink-700)',
        lineHeight: 1.5,
      }}
    >
      <span aria-hidden="true" style={{ color: 'var(--tassel)', fontWeight: 700, flexShrink: 0 }}>!</span>
      <span>
        Last post attempt failed.
        {errorMessage ? (
          <>
            {' '}
            <span style={{ color: 'var(--ink-500)' }}>{String(errorMessage).split('\n')[0].slice(0, 180)}</span>
          </>
        ) : null}
        {' '}Tap to retry.
      </span>
    </div>
  );
}
