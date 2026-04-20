import Link from 'next/link';

export const metadata = { title: 'Connect Buffer — Torah Tai Chi' };

export default function BufferSetupPage() {
  return (
    <div className="stagger" style={{ maxWidth: '640px' }}>
      <div>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(32px, 5vw, 48px)',
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            margin: '0 0 12px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 110, "SOFT" 30',
          }}
        >
          Connect{' '}
          <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>Buffer.</em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '15px',
            color: 'var(--ink-500)',
            margin: '0 0 44px 0',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
          }}
        >
          Buffer schedules your videos across TikTok, Instagram, YouTube, and Facebook.
        </p>
      </div>

      {[
        {
          step: '1',
          title: 'Sign up for Buffer',
          body: 'Go to buffer.com and sign up for the Essentials plan ($12/month). This covers 4 social channels.',
          link: { href: 'https://buffer.com/pricing', label: 'buffer.com/pricing →' },
        },
        {
          step: '2',
          title: 'Connect your social accounts',
          body: 'In Buffer\'s dashboard, connect TikTok, Instagram, YouTube, and Facebook.',
          link: null,
        },
        {
          step: '3',
          title: 'Create a Buffer app',
          body: 'Go to buffer.com/developers/apps and create a new app. Name it "Torah Tai Chi". Get your access token.',
          link: { href: 'https://buffer.com/developers/apps', label: 'buffer.com/developers/apps →' },
        },
        {
          step: '4',
          title: 'Add token to .env',
          body: 'In your dashboard .env file, add: BUFFER_ACCESS_TOKEN=your_token_here — then restart the dev server or redeploy.',
          link: null,
        },
      ].map(({ step, title, body, link }) => (
        <div
          key={step}
          style={{
            display: 'flex',
            gap: '20px',
            paddingBottom: '28px',
            marginBottom: '28px',
            borderBottom: '1px solid var(--ink-100)',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'var(--navy-800)',
              color: 'var(--linen-50)',
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'var(--ff-body)',
              fontWeight: 600,
              fontSize: '14px',
              flexShrink: 0,
              marginTop: '2px',
            }}
          >
            {step}
          </div>
          <div>
            <h2
              style={{
                fontFamily: 'var(--ff-display)',
                fontWeight: 500,
                fontSize: '17px',
                color: 'var(--ink-900)',
                margin: '0 0 6px 0',
                fontVariationSettings: '"opsz" 18, "SOFT" 30',
              }}
            >
              {title}
            </h2>
            <p
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '14px',
                color: 'var(--ink-600)',
                margin: link ? '0 0 10px 0' : 0,
                lineHeight: 1.55,
                fontVariationSettings: '"opsz" 14, "SOFT" 50',
              }}
            >
              {body}
            </p>
            {link && (
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontSize: '13px',
                  color: 'var(--navy-700)',
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--navy-300)',
                  textUnderlineOffset: '3px',
                }}
              >
                {link.label}
              </a>
            )}
          </div>
        </div>
      ))}

      <div
        style={{
          padding: '20px 24px',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-50)',
          marginBottom: '32px',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--ink-500)',
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          See{' '}
          <code style={{ fontSize: '12px', background: 'var(--ink-100)', padding: '2px 6px', borderRadius: '4px', color: 'var(--ink-700)' }}>
            docs/buffer-setup.md
          </code>{' '}
          in the project root for full instructions.
        </p>
      </div>

      <Link
        href="/settings"
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: '14px',
          color: 'var(--ink-500)',
          textDecoration: 'none',
          minHeight: '44px',
          display: 'inline-flex',
          alignItems: 'center',
          transition: 'color var(--trans)',
        }}
      >
        ← Back to Settings
      </Link>
    </div>
  );
}
