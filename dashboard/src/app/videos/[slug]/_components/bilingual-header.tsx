// dashboard/src/app/videos/[slug]/_components/bilingual-header.tsx
//
// The same bilingual header from the legacy page (page-legacy.tsx lines ~588-687),
// lifted into its own component for reuse across the new page's 4 states.
// Hebrew name + book + parsha display title with the existing typographic
// treatment from the legacy page — copied verbatim, not reinterpreted.

interface Props {
  hebrewName: string | null;
  book: string;
  name: string;
}

export function BilingualHeader({ hebrewName, book, name }: Props) {
  return (
    <header
      style={{
        marginBottom: '20px',
        paddingBottom: '24px',
        borderBottom: '1px solid var(--ink-100)',
      }}
    >
      {hebrewName && (
        <div
          lang="he"
          dir="rtl"
          style={{
            fontFamily: 'var(--ff-hebrew)',
            fontSize: 'clamp(28px, 4vw, 42px)',
            fontWeight: 400,
            color: 'var(--ink-700)',
            lineHeight: 1,
            marginBottom: '16px',
            textAlign: 'right',
            direction: 'rtl',
          }}
        >
          {hebrewName}
        </div>
      )}
      <div
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: '10.5px',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--cedar-600)',
          marginBottom: '8px',
        }}
      >
        {book}
      </div>
      <h1
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 400,
          fontSize: 'clamp(36px, 6vw, 72px)',
          lineHeight: 0.96,
          letterSpacing: '-0.035em',
          color: 'var(--ink-900)',
          margin: 0,
          fontVariationSettings: '"opsz" 144, "SOFT" 20',
        }}
      >
        {name}
        <em
          style={{
            fontStyle: 'italic',
            color: 'var(--cedar-600)',
            fontVariationSettings: '"opsz" 144, "SOFT" 70',
          }}
        >
          .
        </em>
      </h1>
    </header>
  );
}
