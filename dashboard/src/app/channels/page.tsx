import { PlatformIcon } from '@/components/platform-icon';

const CHANNELS = [
  {
    platform: 'tiktok' as const,
    name: 'TikTok',
    connected: true,
    followers: '847',
    followerLabel: 'followers',
    lastPost: 'Apr 15',
  },
  {
    platform: 'instagram' as const,
    name: 'Instagram',
    connected: true,
    followers: '1,203',
    followerLabel: 'followers',
    lastPost: 'Apr 15',
  },
  {
    platform: 'youtube' as const,
    name: 'YouTube',
    connected: true,
    followers: '234',
    followerLabel: 'subscribers',
    lastPost: 'Apr 14',
  },
  {
    platform: 'facebook' as const,
    name: 'Facebook',
    connected: true,
    followers: '511',
    followerLabel: 'followers',
    lastPost: 'Apr 15',
  },
  {
    platform: 'website' as const,
    name: 'Website',
    connected: false,
    followers: null,
    followerLabel: null,
    lastPost: null,
  },
];

export default function ChannelsPage() {
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
          Your <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>channels.</em>
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
          4 of 5 connected. Each video posts to all active channels automatically.
        </p>
      </div>

      {/* Channel grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '14px',
        }}
        className="channel-grid"
      >
        {CHANNELS.map((ch) => (
          <div
            key={ch.platform}
            style={{
              padding: '28px 28px 24px',
              border: '1px solid var(--ink-100)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--linen-50)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              transition: 'all var(--trans)',
            }}
            className="ch-card"
          >
            {/* Icon + name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--ink-100)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--ink-500)',
                  flexShrink: 0,
                }}
              >
                <PlatformIcon name={ch.platform} size={22} />
              </div>
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontWeight: 500,
                  fontSize: '20px',
                  color: 'var(--ink-900)',
                  letterSpacing: '-0.015em',
                  fontVariationSettings: '"opsz" 36, "SOFT" 30',
                }}
              >
                {ch.name}
              </div>
            </div>

            {/* Connection status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: ch.connected ? 'var(--jade)' : 'var(--ink-300)',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: ch.connected ? 'var(--ink-700)' : 'var(--ink-400)' }}>
                {ch.connected ? 'Connected' : 'Not connected'}
              </span>
            </div>

            {/* Stats / CTA */}
            {ch.connected && ch.followers ? (
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '14px',
                  color: 'var(--ink-500)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 50',
                  lineHeight: 1.6,
                }}
              >
                <strong
                  style={{
                    fontWeight: 500,
                    fontStyle: 'normal',
                    color: 'var(--ink-900)',
                    fontVariationSettings: '"opsz" 14, "SOFT" 20',
                  }}
                >
                  {ch.followers}
                </strong>{' '}
                {ch.followerLabel}
                <br />
                Last post: {ch.lastPost}
              </div>
            ) : (
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '14px',
                  color: 'var(--ink-400)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 50',
                }}
              >
                Not yet connected.
              </div>
            )}

            {/* Action */}
            <div
              style={{
                marginTop: 'auto',
                paddingTop: '12px',
                borderTop: '1px dotted var(--ink-100)',
              }}
            >
              {ch.connected ? (
                <button
                  type="button"
                  style={{
                    fontFamily: 'var(--ff-body)',
                    fontSize: '13px',
                    color: 'var(--ink-500)',
                    textDecoration: 'underline',
                    textDecorationColor: 'var(--ink-200)',
                    textUnderlineOffset: '4px',
                    cursor: 'pointer',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    minHeight: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    transition: 'all var(--trans)',
                  }}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontFamily: 'var(--ff-body)',
                    fontWeight: 500,
                    fontSize: '14px',
                    padding: '11px 22px',
                    minHeight: '44px',
                    borderRadius: '999px',
                    border: '1px solid var(--navy-800)',
                    background: 'var(--navy-800)',
                    color: 'var(--linen-50)',
                    cursor: 'pointer',
                    transition: 'all var(--trans)',
                  }}
                >
                  Connect your site
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
