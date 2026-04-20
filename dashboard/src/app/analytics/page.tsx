import { Suspense } from 'react';
import Link from 'next/link';
import { getConnection, listChannelVideos, type ChannelVideoStats } from '@/lib/youtube';

// Cache the analytics page for 5 minutes. Every load used to burn
// 3 YouTube API calls (~3 quota units of 10k/day) — harmless but
// slow (~300ms). Stats move slowly enough that 5 min is fine.
export const revalidate = 300;

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 10_000)    return (n / 1_000).toFixed(0) + 'K';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffDays = Math.floor((now - d.getTime()) / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseDuration(iso: string): string {
  // ISO 8601 duration, e.g. "PT45S" or "PT2M15S"
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = Number(m[1] ?? 0);
  const mi = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  if (h > 0) return `${h}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${mi}:${String(s).padStart(2, '0')}`;
}

function Totals({ videos }: { videos: ChannelVideoStats[] }) {
  const views = videos.reduce((a, v) => a + v.views, 0);
  const likes = videos.reduce((a, v) => a + v.likes, 0);
  const comments = videos.reduce((a, v) => a + v.comments, 0);
  const cells = [
    { label: 'Videos', value: String(videos.length) },
    { label: 'Total views', value: formatNumber(views) },
    { label: 'Total likes', value: formatNumber(likes) },
    { label: 'Total comments', value: formatNumber(comments) },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '14px',
        marginBottom: '36px',
      }}
    >
      {cells.map((c) => (
        <div
          key={c.label}
          style={{
            padding: '18px 22px',
            border: '1px solid var(--ink-100)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--linen-50)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--ff-body)',
              fontSize: '10.5px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-400)',
              marginBottom: '8px',
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontWeight: 500,
              fontSize: '28px',
              letterSpacing: '-0.015em',
              color: 'var(--ink-900)',
              fontVariationSettings: '"opsz" 36, "SOFT" 30',
            }}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function PrivacyPill({ status }: { status: string }) {
  const cfg = status === 'public'
    ? { bg: 'rgba(90,110,61,.12)', color: 'var(--jade)', dot: 'var(--jade)', label: 'Public' }
    : status === 'unlisted'
    ? { bg: 'rgba(168,114,47,.12)', color: 'var(--cedar-700)', dot: 'var(--cedar-500)', label: 'Unlisted' }
    : { bg: 'rgba(140,125,100,.1)', color: 'var(--ink-500)', dot: 'var(--ink-400)', label: 'Private' };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontFamily: 'var(--ff-body)',
        fontSize: '11px',
        fontWeight: 500,
        padding: '3px 10px 3px 8px',
        borderRadius: '999px',
        background: cfg.bg,
        color: cfg.color,
      }}
    >
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

async function VideoList() {
  let videos: ChannelVideoStats[] = [];
  let fetchError: string | null = null;
  try {
    videos = await listChannelVideos(25);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  if (fetchError) {
    return (
      <div
        style={{
          padding: '18px 22px',
          border: '1px solid rgba(192,57,43,.2)',
          borderRadius: 'var(--r-lg)',
          background: 'rgba(192,57,43,.06)',
          fontFamily: 'var(--ff-body)',
          fontSize: '13.5px',
          color: '#8b2d1c',
          lineHeight: 1.55,
        }}
      >
        Couldn&apos;t fetch channel stats: {fetchError}
      </div>
    );
  }
  if (videos.length === 0) {
    return (
      <div
        style={{
          padding: '40px',
          textAlign: 'center',
          border: '1px dashed var(--ink-200)',
          borderRadius: 'var(--r-lg)',
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '15px',
          color: 'var(--ink-500)',
        }}
      >
        No uploads yet. Once you post your first video, stats will appear here.
      </div>
    );
  }
  return (
    <>
      <Totals videos={videos} />
      <VideoRows videos={videos} />
    </>
  );
}

function VideoListSkeleton() {
  return (
    <div
      style={{
        padding: '40px',
        textAlign: 'center',
        fontFamily: 'var(--ff-display)',
        fontStyle: 'italic',
        fontSize: '14px',
        color: 'var(--ink-400)',
      }}
    >
      <div
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          border: '2px solid var(--ink-100)',
          borderTopColor: 'var(--cedar-500)',
          margin: '0 auto 12px',
          animation: 'tt-spin 0.9s linear infinite',
        }}
      />
      Loading videos from YouTube…
    </div>
  );
}

function VideoRows({ videos }: { videos: ChannelVideoStats[] }) {
  return (
    <div
      style={{
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--linen-50)',
        overflow: 'hidden',
      }}
    >
      {videos.map((v, idx) => (
        <a
          key={v.id}
          href={`https://www.youtube.com/watch?v=${v.id}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'grid',
            gridTemplateColumns: '112px 1fr auto',
            gap: '20px',
            alignItems: 'center',
            padding: '14px 18px',
            borderTop: idx === 0 ? 'none' : '1px solid var(--ink-100)',
            textDecoration: 'none',
            color: 'inherit',
            transition: 'background var(--trans)',
          }}
          className="perf-row"
        >
          <div
            style={{
              width: '112px',
              aspectRatio: '16/9',
              borderRadius: 'var(--r-sm)',
              background: 'var(--ink-100)',
              overflow: 'hidden',
              position: 'relative',
              flexShrink: 0,
            }}
          >
            {v.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={v.thumbnailUrl}
                alt=""
                aria-hidden="true"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            )}
            {v.durationIso && (
              <span
                style={{
                  position: 'absolute',
                  bottom: '4px',
                  right: '4px',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  background: 'rgba(0,0,0,.72)',
                  color: '#fff',
                  fontFamily: 'var(--ff-body)',
                  fontSize: '10.5px',
                  fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {parseDuration(v.durationIso)}
              </span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontWeight: 500,
                fontSize: '16px',
                letterSpacing: '-0.005em',
                color: 'var(--ink-900)',
                fontVariationSettings: '"opsz" 18, "SOFT" 20',
                marginBottom: '5px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {v.title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <PrivacyPill status={v.privacyStatus} />
              <span
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '12.5px',
                  color: 'var(--ink-400)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 50',
                }}
              >
                {formatDate(v.publishedAt)}
              </span>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(60px, auto))',
              gap: '22px',
              textAlign: 'right',
              fontFamily: 'var(--ff-display)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {[
              { label: 'Views', value: v.views },
              { label: 'Likes', value: v.likes },
              { label: 'Comments', value: v.comments },
            ].map((s) => (
              <div key={s.label}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: '18px',
                    color: 'var(--ink-900)',
                    letterSpacing: '-0.01em',
                    fontVariationSettings: '"opsz" 20, "SOFT" 20',
                  }}
                >
                  {formatNumber(s.value)}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ff-body)',
                    fontSize: '10px',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-400)',
                    marginTop: '2px',
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </a>
      ))}
    </div>
  );
}

export default async function AnalyticsPage() {
  const connection = await getConnection();

  if (!connection.connected) {
    return (
      <div className="stagger">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: '80px 40px',
            maxWidth: '480px',
            margin: '0 auto',
          }}
        >
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
            Connect YouTube{' '}
            <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 72, "SOFT" 60' }}>
              to see performance.
            </em>
          </h1>
          <p
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '15.5px',
              lineHeight: 1.55,
              color: 'var(--ink-500)',
              margin: '0 0 28px 0',
              fontVariationSettings: '"opsz" 18, "SOFT" 50',
            }}
          >
            Video performance pulls directly from your YouTube channel — views, likes, comments, and publish status per video.
          </p>
          <Link
            href="/channels"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: '14px',
              padding: '12px 24px',
              minHeight: '44px',
              borderRadius: '999px',
              border: '1px solid var(--navy-800)',
              background: 'var(--navy-800)',
              color: 'var(--linen-50)',
              textDecoration: 'none',
            }}
          >
            Go to Channels →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stagger">
      {/* Header */}
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
          Video{' '}
          <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>
            performance.
          </em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '16px',
            color: 'var(--ink-500)',
            margin: '0 0 36px 0',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
          }}
        >
          YouTube — {connection.channelTitle}. Most recent 25 uploads.
        </p>
      </div>

      <Suspense fallback={<VideoListSkeleton />}>
        <VideoList />
      </Suspense>
    </div>
  );
}
