import Link from 'next/link';

// Hardcoded 6-week rolling calendar. Hebcal integration comes later.
const WEEKS = [
  {
    slug: 'kedoshim',
    date: 'Apr 25',
    when: 'This Friday',
    eng: 'Kedoshim',
    heb: 'קְדֹשִׁים',
    dotColor: 'var(--jade)',
    dotClass: 'jade',
    status: 'Video approved, ships Friday',
    current: true,
  },
  {
    slug: 'emor',
    date: 'May 2',
    when: 'Next week',
    eng: 'Emor',
    heb: 'אֱמוֹר',
    dotColor: 'var(--cedar-500)',
    dotClass: 'cedar',
    status: 'Script ready, video pending',
    current: false,
  },
  {
    slug: 'behar',
    date: 'May 9',
    when: 'In 3 weeks',
    eng: 'Behar',
    heb: 'בְּהַר',
    dotColor: 'var(--cedar-500)',
    dotClass: 'cedar',
    status: 'Needs review',
    current: false,
  },
  {
    slug: 'bechukotai',
    date: 'May 16',
    when: 'In 4 weeks',
    eng: 'Bechukotai',
    heb: 'בְּחֻקֹּתַי',
    dotColor: 'var(--navy-700)',
    dotClass: 'navy',
    status: 'Generating...',
    current: false,
  },
  {
    slug: 'bamidbar',
    date: 'May 23',
    when: 'In 5 weeks',
    eng: 'Bamidbar',
    heb: 'בְּמִדְבַּר',
    dotColor: 'var(--ink-300)',
    dotClass: 'gray',
    status: 'Not started',
    current: false,
  },
  {
    slug: 'naso',
    date: 'May 30',
    when: 'In 6 weeks',
    eng: 'Naso',
    heb: 'נָשֹׂא',
    dotColor: 'var(--ink-300)',
    dotClass: 'gray',
    status: 'Not started',
    current: false,
  },
];

export default function CalendarPage() {
  return (
    <div className="stagger">
      {/* Page header */}
      <div>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(36px, 5vw, 56px)',
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            margin: '0 0 8px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 110, "SOFT" 30',
          }}
        >
          Six weeks <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>ahead.</em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '16px',
            color: 'var(--ink-500)',
            margin: '0 0 44px 0',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
          }}
        >
          Your rolling view of what&apos;s coming, what&apos;s ready, and what needs your eye.
        </p>
      </div>

      {/* Calendar rows */}
      <div>
        {WEEKS.map((week, i) => (
          <>
            {/* Holiday banner between week 2 and week 3 (index 1 and 2) */}
            {i === 2 && (
              <div
                key="lag-bomer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 24px',
                  marginBottom: '10px',
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '13px',
                  color: 'var(--cedar-600)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 60',
                }}
              >
                <div
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: 'var(--cedar-100)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '10px',
                    flexShrink: 0,
                  }}
                >
                  ✨
                </div>
                Lag B&apos;Omer · Sunday, May 4
              </div>
            )}

            <Link
              key={week.slug}
              href={`/videos/${week.slug}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr auto',
                gap: '20px',
                alignItems: 'center',
                padding: '20px 24px',
                border: `1px solid ${week.current ? 'var(--cedar-300)' : 'var(--ink-100)'}`,
                borderRadius: 'var(--r-lg)',
                background: week.current
                  ? 'linear-gradient(180deg, var(--linen-100) 0%, var(--linen-50) 80%)'
                  : 'var(--linen-50)',
                marginBottom: '10px',
                cursor: 'pointer',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'all var(--trans)',
                minHeight: '44px',
                position: 'relative',
              }}
              className={`cal-week${week.current ? ' cal-week-current' : ''}`}
            >
              {/* Current week top bar accent */}
              {week.current && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '3px',
                    background: 'linear-gradient(90deg, var(--cedar-500), var(--cedar-600))',
                    borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
                  }}
                />
              )}

              {/* Date column */}
              <div
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontSize: '13px',
                  color: 'var(--ink-500)',
                }}
              >
                <strong style={{ fontWeight: 500, color: 'var(--ink-900)', display: 'block', fontSize: '14px' }}>
                  {week.date}
                </strong>
                {week.when}
              </div>

              {/* Parsha name */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontWeight: 500,
                    fontSize: '20px',
                    color: 'var(--ink-900)',
                    letterSpacing: '-0.015em',
                    fontVariationSettings: '"opsz" 36, "SOFT" 30',
                  }}
                >
                  {week.eng}
                </span>
                <span
                  lang="he"
                  dir="rtl"
                  style={{
                    fontFamily: 'var(--ff-hebrew)',
                    fontSize: '16px',
                    color: 'var(--ink-500)',
                  }}
                >
                  {week.heb}
                </span>
              </div>

              {/* Status */}
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '13.5px',
                  color: 'var(--ink-500)',
                  textAlign: 'right',
                  fontVariationSettings: '"opsz" 14, "SOFT" 50',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    marginRight: '8px',
                    transform: 'translateY(-1px)',
                    background: week.dotColor,
                    animation: week.dotClass === 'navy' ? 'pulse-navy 1.8s ease-in-out infinite' : undefined,
                  }}
                />
                {week.status}
              </div>
            </Link>
          </>
        ))}
      </div>
    </div>
  );
}
