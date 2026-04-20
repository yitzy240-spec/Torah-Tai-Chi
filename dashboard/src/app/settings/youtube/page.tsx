import Link from 'next/link';

export const metadata = { title: 'Connect YouTube — Torah Tai Chi' };

const ORIGIN = 'https://torah-tai-chi-admin.vercel.app';

const STEPS = [
  {
    step: '1',
    title: 'Create a Google Cloud project',
    body: 'Go to console.cloud.google.com, click the project dropdown, and create a new project called "Torah Tai Chi". This takes about 30 seconds.',
    link: { href: 'https://console.cloud.google.com/projectcreate', label: 'console.cloud.google.com/projectcreate →' },
  },
  {
    step: '2',
    title: 'Enable the YouTube Data API v3',
    body: 'Inside the new project, open APIs & Services → Library. Search for "YouTube Data API v3" and click Enable.',
    link: { href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', label: 'Enable YouTube Data API →' },
  },
  {
    step: '3',
    title: 'Configure the OAuth consent screen',
    body: 'APIs & Services → OAuth consent screen. User type: External. App name: Torah Tai Chi. Add your own email as a Test User. No other fields are required for now.',
    link: { href: 'https://console.cloud.google.com/apis/credentials/consent', label: 'Consent screen setup →' },
  },
  {
    step: '4',
    title: 'Create OAuth credentials',
    body: `APIs & Services → Credentials → Create credentials → OAuth client ID. Type: "Web application". Authorized redirect URI: ${ORIGIN}/api/auth/youtube/callback`,
    link: { href: 'https://console.cloud.google.com/apis/credentials', label: 'Create OAuth client →' },
  },
  {
    step: '5',
    title: 'Paste Client ID + Secret into Vercel',
    body: 'Copy the Client ID and Client Secret from the credentials page. In your Vercel dashboard, add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to the torah-tai-chi-admin project (Production). Then redeploy.',
    link: { href: 'https://vercel.com/yitzys-projects-8a002092/torah-tai-chi-admin/settings/environment-variables', label: 'Vercel env vars →' },
  },
  {
    step: '6',
    title: 'Click "Connect YouTube"',
    body: 'After the redeploy is live, come back to the Channels page and click Connect YouTube on the YouTube card. Google will ask for consent; approve and you\'ll land back here connected.',
    link: null,
  },
] as const;

export default function YouTubeSetupPage() {
  return (
    <div className="stagger" style={{ maxWidth: '720px' }}>
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
          <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>YouTube.</em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '15px',
            color: 'var(--ink-500)',
            margin: '0 0 44px 0',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
            lineHeight: 1.5,
          }}
        >
          YouTube uploads go direct via Google&apos;s Data API (not through Buffer). Free to use, supports
          custom thumbnails and full metadata. This is a one-time setup — about 10 minutes in Google Cloud.
        </p>
      </div>

      {STEPS.map(({ step, title, body, link }) => (
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
          While the app is in &ldquo;Testing&rdquo; mode, only users listed under{' '}
          <strong style={{ fontWeight: 500 }}>Test users</strong> on the consent screen can connect. Add
          yourself (and Yonah later) there. Publishing to &ldquo;In production&rdquo; requires a verification
          process — not needed for our use case since only Yonah ever connects.
        </p>
      </div>

      <Link
        href="/channels"
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
        ← Back to Channels
      </Link>
    </div>
  );
}
