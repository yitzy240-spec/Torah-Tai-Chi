export default function AnalyticsPage() {
  return (
    <div className="stagger">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '100px 40px',
          maxWidth: '520px',
          margin: '0 auto',
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            background: 'var(--linen-100)',
            border: '1px solid var(--ink-100)',
            display: 'grid',
            placeItems: 'center',
            marginBottom: '28px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            style={{ width: '32px', height: '32px', color: 'var(--cedar-400)' }}
          >
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>
          </svg>
        </div>

        {/* Heading */}
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(28px, 4vw, 40px)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: '0 0 16px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 72, "SOFT" 30',
          }}
        >
          Analytics{' '}
          <em
            style={{
              fontStyle: 'italic',
              color: 'var(--ink-500)',
              fontVariationSettings: '"opsz" 72, "SOFT" 60',
            }}
          >
            coming soon.
          </em>
        </h1>

        {/* Body */}
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '17px',
            lineHeight: 1.55,
            color: 'var(--ink-500)',
            margin: 0,
            fontVariationSettings: '"opsz" 18, "SOFT" 50',
          }}
        >
          Cross-channel performance will show here once videos start posting. Check back after your first week of distribution — the numbers will find you.
        </p>
      </div>
    </div>
  );
}
