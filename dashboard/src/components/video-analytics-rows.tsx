'use client';

import { useState } from 'react';
import { getVideoAnalytics, type VideoAnalyticsBundle } from
  '@/app/actions/get-video-analytics';
import type { ChannelVideoStats } from '@/lib/youtube';

/** Same number-formatter used by the server-side cards. Inlined so this
 *  client component doesn't pull in the page module. */
function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatWatchMinutes(min: number): string {
  if (min <= 0) return '0m';
  if (min < 1) return `${Math.round(min * 60)}s`;
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function parseDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = Number(m[1] ?? 0);
  const mi = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  if (h > 0) return `${h}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${mi}:${String(s).padStart(2, '0')}`;
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

function countryName(code: string): string {
  if (!code) return 'Unknown';
  if (code === 'ZZ') return 'Unknown region';
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return dn.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function formatAgeGroup(raw: string): string {
  return raw.replace(/^age/i, '').replace('-', '–');
}

function formatGender(g: string): string {
  switch (g) {
    case 'male': return 'Male';
    case 'female': return 'Female';
    case 'user_specified': return 'Other';
    default: return 'Unknown';
  }
}

/** YouTube's traffic source enum is mostly self-explanatory but the
 *  short names are jargon-y; map to friendly labels. Unknown values fall
 *  through to the raw enum so we don't silently drop new categories. */
function trafficSourceLabel(raw: string): string {
  const map: Record<string, string> = {
    YT_SEARCH: 'YouTube search',
    SUGGESTED_VIDEO: 'Suggested videos',
    BROWSE: 'Browse / home',
    EXT_URL: 'External (links)',
    SHORTS: 'Shorts feed',
    PLAYLIST: 'Playlists',
    DIRECT_OR_UNKNOWN: 'Direct / unknown',
    NO_LINK_OTHER: 'Other',
    NO_LINK_EMBEDDED: 'Embedded',
    YT_CHANNEL: 'Channel page',
    NOTIFICATION: 'Notifications',
    SUBSCRIBER: 'Subscriptions feed',
    CAMPAIGN_CARD: 'Campaign card',
    END_SCREEN: 'End screens',
    ANNOTATION: 'Annotations',
    CARDS: 'Cards',
    HASHTAGS: 'Hashtag pages',
    LIVE: 'Live',
    PRODUCT_PAGE: 'Product page',
    YT_OTHER_PAGE: 'Other YouTube page',
    YT_PLAYLIST_PAGE: 'Playlist page',
    RELATED_VIDEO: 'Related videos',
    VIDEO_REMIXES: 'Remixes',
  };
  return map[raw] ?? raw;
}

interface Props {
  videos: ChannelVideoStats[];
}

/**
 * Click-to-expand video list. Replaces the old anchor-wrapped row layout —
 * the row click now toggles a per-video drawer with country breakdown,
 * age × gender, retention curve, and traffic sources for THAT video.
 * The "open on YouTube ↗" link is a separate anchor inside the row so
 * users can still jump to YouTube without expanding.
 *
 * Bundle is fetched lazily via getVideoAnalytics on first expand and
 * cached for 1h server-side (see actions/get-video-analytics.ts), so
 * repeated open/close cycles within an hour cost zero quota.
 */
export function VideoAnalyticsRows({ videos }: Props) {
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
        <VideoRow key={v.id} video={v} isFirst={idx === 0} />
      ))}
    </div>
  );
}

function VideoRow({ video, isFirst }: { video: ChannelVideoStats; isFirst: boolean }) {
  const [open, setOpen] = useState(false);
  const [bundle, setBundle] = useState<VideoAnalyticsBundle | null>(null);
  const [loading, setLoading] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !bundle && !loading) {
      setLoading(true);
      void getVideoAnalytics(video.id)
        .then((b) => setBundle(b))
        .finally(() => setLoading(false));
    }
  }

  return (
    <div style={{ borderTop: isFirst ? 'none' : '1px solid var(--ink-100)' }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: 'grid',
          gridTemplateColumns: '112px 1fr auto 28px',
          gap: '20px',
          alignItems: 'center',
          padding: '14px 18px',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
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
          {video.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.thumbnailUrl}
              alt=""
              aria-hidden="true"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
          {video.durationIso && (
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
              {parseDuration(video.durationIso)}
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
            {video.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <PrivacyPill status={video.privacyStatus} />
            <span
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '12.5px',
                color: 'var(--ink-400)',
                fontVariationSettings: '"opsz" 14, "SOFT" 50',
              }}
            >
              {formatDate(video.publishedAt)}
            </span>
            <a
              href={`https://www.youtube.com/watch?v=${video.id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '11.5px',
                color: 'var(--ink-500)',
                textDecoration: 'underline',
                textUnderlineOffset: '2px',
              }}
            >
              Open on YouTube ↗
            </a>
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
            { label: 'Views', value: video.views },
            { label: 'Likes', value: video.likes },
            { label: 'Comments', value: video.comments },
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
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 180ms ease',
            color: 'var(--ink-400)',
            fontSize: '14px',
            lineHeight: 1,
            fontFamily: 'var(--ff-display)',
          }}
        >
          ›
        </span>
      </button>
      {open && (
        <ExpandedDrawer bundle={bundle} loading={loading} videoId={video.id} />
      )}
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

function ExpandedDrawer({
  bundle, loading, videoId,
}: {
  bundle: VideoAnalyticsBundle | null;
  loading: boolean;
  videoId: string;
}) {
  return (
    <div
      style={{
        padding: '0 18px 22px',
        borderTop: '1px dashed var(--ink-100)',
        background: 'var(--linen-100)',
      }}
    >
      {loading && !bundle ? (
        <p
          style={{
            padding: '20px 0',
            margin: 0,
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13px',
            color: 'var(--ink-400)',
          }}
        >
          Loading audience for this video…
        </p>
      ) : bundle?.needsReconsent ? (
        <p
          style={{
            padding: '20px 0',
            margin: 0,
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13px',
            color: 'var(--ink-500)',
          }}
        >
          Reconnect YouTube to see this video&apos;s audience breakdown.{' '}
          <a href="/api/auth/youtube/start" style={{ color: 'var(--cedar-700)' }}>
            Reconnect →
          </a>
        </p>
      ) : bundle?.loadError ? (
        <p
          style={{
            padding: '20px 0',
            margin: 0,
            fontFamily: 'var(--ff-body)',
            fontSize: '12px',
            color: 'var(--tassel)',
            wordBreak: 'break-word',
          }}
        >
          Couldn&apos;t load this video&apos;s audience: {bundle.loadError}
        </p>
      ) : bundle ? (
        <div
          style={{
            display: 'grid',
            gap: '20px',
            paddingTop: '18px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          <CountriesPanel countries={bundle.countries} />
          <AgeGenderPanel ageGender={bundle.ageGender} />
          <TrafficSourcesPanel sources={bundle.trafficSources} />
          <RetentionPanel retention={bundle.retention} />
        </div>
      ) : null}
      <p
        style={{
          margin: '14px 0 0',
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '11.5px',
          color: 'var(--ink-400)',
        }}
      >
        Last 28 days. Cached 1h. Video {videoId}.
      </p>
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--ff-body)',
        fontSize: '10.5px',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-400)',
        marginBottom: '10px',
      }}
    >
      {children}
    </div>
  );
}

function PanelEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: 'var(--ff-display)',
        fontStyle: 'italic',
        fontSize: '12.5px',
        color: 'var(--ink-400)',
      }}
    >
      {children}
    </p>
  );
}

function CountriesPanel({
  countries,
}: { countries: VideoAnalyticsBundle['countries'] }) {
  const total = countries.reduce((a, c) => a + c.views, 0);
  return (
    <div>
      <PanelTitle>Top countries</PanelTitle>
      {countries.length === 0 ? (
        <PanelEmpty>
          Not enough views yet for country data (Shorts need ~500+ views).
        </PanelEmpty>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {countries.slice(0, 5).map((c) => {
            const pct = total > 0 ? (c.views / total) * 100 : 0;
            return (
              <li
                key={c.countryCode || 'unknown'}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '8px',
                  alignItems: 'baseline',
                  padding: '4px 0',
                  fontFamily: 'var(--ff-display)',
                  fontSize: '13px',
                  color: 'var(--ink-700)',
                }}
              >
                <span>{countryName(c.countryCode)}</span>
                <span
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--ink-500)',
                    fontStyle: 'italic',
                  }}
                >
                  {formatNumber(c.views)} · {pct.toFixed(0)}%
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function AgeGenderPanel({
  ageGender,
}: { ageGender: VideoAnalyticsBundle['ageGender'] }) {
  return (
    <div>
      <PanelTitle>Age × gender</PanelTitle>
      {ageGender.length === 0 ? (
        <PanelEmpty>
          Insufficient data — needs ~100+ views per cohort.
        </PanelEmpty>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {[...ageGender]
            .sort((a, b) => b.viewerPercentage - a.viewerPercentage)
            .slice(0, 5)
            .map((r) => (
              <li
                key={`${r.ageGroup}-${r.gender}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '8px',
                  padding: '4px 0',
                  fontFamily: 'var(--ff-display)',
                  fontSize: '13px',
                  color: 'var(--ink-700)',
                }}
              >
                <span>
                  {formatGender(r.gender)} {formatAgeGroup(r.ageGroup)}
                </span>
                <span
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--ink-500)',
                    fontStyle: 'italic',
                  }}
                >
                  {r.viewerPercentage.toFixed(1)}%
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function TrafficSourcesPanel({
  sources,
}: { sources: VideoAnalyticsBundle['trafficSources'] }) {
  const total = sources.reduce((a, s) => a + s.views, 0);
  return (
    <div>
      <PanelTitle>How they got here</PanelTitle>
      {sources.length === 0 ? (
        <PanelEmpty>No traffic source data yet.</PanelEmpty>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {sources.slice(0, 5).map((s) => {
            const pct = total > 0 ? (s.views / total) * 100 : 0;
            return (
              <li
                key={s.sourceType}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '8px',
                  padding: '4px 0',
                  fontFamily: 'var(--ff-display)',
                  fontSize: '13px',
                  color: 'var(--ink-700)',
                }}
              >
                <span>{trafficSourceLabel(s.sourceType)}</span>
                <span
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--ink-500)',
                    fontStyle: 'italic',
                  }}
                >
                  {formatNumber(s.views)} · {pct.toFixed(0)}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {sources.length > 0 && total > 0 && (
        <p
          style={{
            margin: '8px 0 0',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '11.5px',
            color: 'var(--ink-400)',
          }}
        >
          {formatWatchMinutes(
            sources.reduce((a, s) => a + s.watchTimeMinutes, 0),
          )} watched in window.
        </p>
      )}
    </div>
  );
}

/**
 * Sparkline-style retention curve. Vertical bars at 10 sample points
 * (0%, 10%, 20%, ..., 100%) showing audienceWatchRatio. A curve close
 * to 1.0 throughout = great retention; sharp drop near 0% = the hook
 * isn't landing.
 */
function RetentionPanel({
  retention,
}: { retention: VideoAnalyticsBundle['retention'] }) {
  if (retention.length === 0) {
    return (
      <div>
        <PanelTitle>Retention curve</PanelTitle>
        <PanelEmpty>Not enough data yet for retention.</PanelEmpty>
      </div>
    );
  }
  // Subsample 11 points (0%, 10%, ..., 100%) — the API returns 101 rows
  // for a typical video, which is too dense for a tiny inline sparkline.
  const buckets = 11;
  const sampled: typeof retention = [];
  for (let i = 0; i < buckets; i++) {
    const targetRatio = i / (buckets - 1);
    let nearest = retention[0];
    let bestDelta = Math.abs(nearest.elapsedRatio - targetRatio);
    for (const p of retention) {
      const d = Math.abs(p.elapsedRatio - targetRatio);
      if (d < bestDelta) {
        nearest = p;
        bestDelta = d;
      }
    }
    sampled.push(nearest);
  }
  const startRatio = sampled[0]?.audienceWatchRatio ?? 0;
  const endRatio = sampled[sampled.length - 1]?.audienceWatchRatio ?? 0;
  return (
    <div>
      <PanelTitle>Retention curve</PanelTitle>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '3px',
          height: '52px',
          marginBottom: '8px',
        }}
      >
        {sampled.map((p, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(2, p.audienceWatchRatio * 100)}%`,
              background: 'var(--cedar-500)',
              borderRadius: '2px 2px 0 0',
              opacity: 0.85,
            }}
            title={`${Math.round(p.elapsedRatio * 100)}% watched · ${(p.audienceWatchRatio * 100).toFixed(0)}% audience`}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '11.5px',
          color: 'var(--ink-400)',
        }}
      >
        <span>start {(startRatio * 100).toFixed(0)}%</span>
        <span>end {(endRatio * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
