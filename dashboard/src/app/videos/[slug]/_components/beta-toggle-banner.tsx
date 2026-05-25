import Link from 'next/link';

// Slim banner at the top of every /videos/[slug] view that lets the
// operator opt into the new (v2) editor or back out to the classic one
// without editing the URL by hand. Lives at the dispatcher level so
// both children render it identically.
//
// Delete this component (and its import in page.tsx) once the legacy
// page is removed.

export function BetaToggleBanner({
  mode,
  slug,
}: {
  mode: 'legacy' | 'new';
  slug: string;
}) {
  if (mode === 'new') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '8px 14px',
          marginBottom: 16,
          background: 'rgba(46,125,94,.08)',
          borderRadius: 'var(--r-md)',
          fontFamily: 'var(--ff-body)',
          fontSize: 13,
          color: 'var(--ink-700)',
          flexWrap: 'wrap',
          minHeight: 44,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontSize: 11,
            color: 'var(--jade)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--jade)',
              display: 'inline-block',
            }}
          />
          Beta editor
        </span>
        <Link
          href={`/videos/${slug}?v2=0`}
          prefetch={false}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            padding: '0 6px',
            color: 'var(--navy-700)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          ← Back to classic editor
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 14px',
        marginBottom: 16,
        background: 'var(--linen-100)',
        borderRadius: 'var(--r-md)',
        fontFamily: 'var(--ff-body)',
        fontSize: 13,
        color: 'var(--ink-500)',
        flexWrap: 'wrap',
        minHeight: 44,
      }}
    >
      <span style={{ fontStyle: 'italic', fontFamily: 'var(--ff-display)' }}>
        Save your work first — switching reloads the page from the database.
      </span>
      <Link
        href={`/videos/${slug}?v2=1`}
        prefetch={false}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: 44,
          padding: '0 12px',
          fontWeight: 500,
          color: 'var(--navy-800)',
          background: 'var(--linen-50)',
          border: '1px solid var(--navy-800)',
          borderRadius: 999,
          textDecoration: 'none',
        }}
      >
        Try the new beta editor →
      </Link>
    </div>
  );
}
