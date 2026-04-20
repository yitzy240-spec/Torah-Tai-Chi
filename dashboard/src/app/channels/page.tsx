import { PlatformIcon } from '@/components/platform-icon';
import { createClient } from '@/lib/supabase/server';
import { listProfiles } from '@/lib/buffer';
import Link from 'next/link';

const BUFFER_PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook'] as const;
type BufferPlatform = typeof BUFFER_PLATFORMS[number];

interface ChannelData {
  platform: BufferPlatform | 'website';
  name: string;
  connected: boolean;
  username: string | null;
  recentPosts: number;
}

async function getChannelData(): Promise<ChannelData[]> {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  const supabase = await createClient();

  // Count recent posts per platform (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: postCounts } = await supabase
    .from('posts')
    .select('platform')
    .gte('created_at', sevenDaysAgo);

  const countByPlatform: Record<string, number> = {};
  for (const p of BUFFER_PLATFORMS) countByPlatform[p] = 0;
  for (const row of postCounts ?? []) {
    if (row.platform in countByPlatform) countByPlatform[row.platform]++;
  }

  // Try to get Buffer profiles
  let profiles: Awaited<ReturnType<typeof listProfiles>> = [];
  if (token) {
    try {
      profiles = await listProfiles(token);
    } catch {
      // token set but API failed — fall through to "not connected"
    }
  }

  const platformChannels: ChannelData[] = BUFFER_PLATFORMS.map((platform) => {
    const profile = profiles.find(
      (p) => p.service?.toLowerCase() === platform || p.formatted_service?.toLowerCase().includes(platform),
    );
    return {
      platform,
      name: platform.charAt(0).toUpperCase() + platform.slice(1),
      connected: !!profile,
      username: profile?.service_username ?? null,
      recentPosts: countByPlatform[platform] ?? 0,
    };
  });

  return [
    ...platformChannels,
    { platform: 'website', name: 'Website', connected: false, username: null, recentPosts: 0 },
  ];
}

export default async function ChannelsPage() {
  const channels = await getChannelData();
  const connectedCount = channels.filter((c) => c.connected).length;
  const bufferConfigured = !!process.env.BUFFER_ACCESS_TOKEN;

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
          {bufferConfigured
            ? `${connectedCount} of 5 connected. Each video posts to all active channels automatically.`
            : 'Buffer not connected. Connect to schedule posts across all channels.'}
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
        {channels.map((ch) => (
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
              <div>
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
                {ch.username && (
                  <div
                    style={{
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                      fontSize: '12px',
                      color: 'var(--ink-400)',
                      fontVariationSettings: '"opsz" 14, "SOFT" 50',
                    }}
                  >
                    @{ch.username}
                  </div>
                )}
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

            {/* Stats */}
            {ch.platform !== 'website' && (
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
                {ch.connected ? (
                  <>
                    <strong
                      style={{
                        fontWeight: 500,
                        fontStyle: 'normal',
                        color: 'var(--ink-900)',
                        fontVariationSettings: '"opsz" 14, "SOFT" 20',
                      }}
                    >
                      {ch.recentPosts}
                    </strong>{' '}
                    post{ch.recentPosts !== 1 ? 's' : ''} in last 7 days
                  </>
                ) : (
                  'Not yet connected.'
                )}
              </div>
            )}

            {ch.platform === 'website' && (
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '14px',
                  color: 'var(--ink-400)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 50',
                }}
              >
                Published directly via Supabase.
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
              {ch.platform === 'website' ? (
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
                  Configure
                </button>
              ) : ch.connected ? (
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
                <Link
                  href="/settings/buffer"
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
                    textDecoration: 'none',
                    transition: 'all var(--trans)',
                  }}
                >
                  Connect
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
