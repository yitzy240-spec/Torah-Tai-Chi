// dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/post-error-hint.tsx
//
// Posting errors used to render as a bare red string ("No Buffer profile
// found for instagram"), which left the operator stuck (Yonah, 2026-06-23:
// IG disconnected in Buffer, no way to self-fix). This wraps the error and,
// when it's a Buffer channel-disconnect, shows a plain-language explanation
// plus a one-click "Reconnect in Buffer" link so the operator can fix it
// without asking. Any other error renders unchanged.

'use client';

// Buffer's channel-management page. A platform whose Buffer channel is
// disconnected (Meta/IG tokens expire ~every 60-90 days) fails posting with
// "No Buffer profile found for <platform>" (see auto-post.ts).
const BUFFER_CHANNELS_URL = 'https://publish.buffer.com/channels';

function isChannelDisconnected(error: string): boolean {
  const e = error.toLowerCase();
  return e.includes('no buffer profile') || e.includes('not connected in buffer');
}

export function PostErrorHint({
  error,
  platform,
  style,
}: {
  error: string | null;
  platform: string;
  style?: React.CSSProperties;
}) {
  if (!error) return null;
  const box: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--tassel)',
    marginBottom: 8,
    lineHeight: 1.5,
    ...style,
  };
  if (!isChannelDisconnected(error)) {
    return <div style={box}>{error}</div>;
  }
  return (
    <div style={box}>
      {platform} isn&rsquo;t connected in Buffer right now — that&rsquo;s why
      this didn&rsquo;t post. Reconnect it in Buffer, then try again.{' '}
      <a
        href={BUFFER_CHANNELS_URL}
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--navy-700)', textDecoration: 'underline', fontWeight: 500 }}
      >
        Reconnect {platform} in Buffer &rarr;
      </a>
    </div>
  );
}
