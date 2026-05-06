import { Suspense } from 'react';
import Link from 'next/link';
import {
  getConnection,
  listChannelVideos,
  getChannelWatchSummary,
  getTopCountries,
  getAgeGenderShare,
  YouTubeScopeError,
  type ChannelVideoStats,
  type ChannelWatchSummary,
  type CountryViewShare,
  type AgeGenderShare,
} from '@/lib/youtube';
import { VideoAnalyticsRows } from '@/components/video-analytics-rows';

// Force dynamic rendering while the new analytics surfaces are being
// debugged — caching at the page level was hiding fresh OAuth state
// after re-consent. Re-introduce a short revalidate window once the
// reconnect flow is verified end-to-end (followup).
export const dynamic = 'force-dynamic';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 10_000)    return (n / 1_000).toFixed(0) + 'K';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/**
 * Format minutes as "1h 23m" / "12m" / "45s" depending on magnitude.
 * Accepts non-integer minutes from the Analytics API.
 */
function formatWatchMinutes(min: number): string {
  if (min <= 0) return '0m';
  if (min < 1) return `${Math.round(min * 60)}s`;
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format an avg-view-duration value (seconds) as m:ss. */
function formatSecondsAsMmSs(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Resolve a 2-letter ISO country code to a friendly English name. Falls
 * back to the raw code if Intl.DisplayNames doesn't recognize it (e.g.
 * the special "ZZ" YouTube uses for "Unknown region").
 */
function countryName(code: string): string {
  if (!code) return 'Unknown';
  if (code === 'ZZ') return 'Unknown region';
  try {
    // Intl.DisplayNames is widely available on modern Node (>=16) and
    // every browser we target.
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return dn.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Pretty-print YouTube's ageGroup buckets ("age25-34" → "25–34"). */
function formatAgeGroup(raw: string): string {
  // Strip leading "age" and replace ASCII hyphen with en-dash.
  return raw.replace(/^age/i, '').replace('-', '–');
}

/** Pretty-print YouTube's gender enum values. */
function formatGender(g: AgeGenderShare['gender']): string {
  switch (g) {
    case 'male':
      return 'Male';
    case 'female':
      return 'Female';
    case 'user_specified':
      return 'Other';
    default:
      return 'Unknown';
  }
}

/**
 * Wrap the three Analytics API calls into a single loader that returns
 * a discriminated bundle. A 403 on any call (typically because the
 * stored token predates the yt-analytics.readonly scope) flips
 * `needsReconsent` so the page can render a reconnect banner. Any
 * other error is logged and silently skipped — the existing totals +
 * video list still render.
 */
async function loadAnalytics(): Promise<{
  watch: ChannelWatchSummary | null;
  countries: CountryViewShare[];
  ageGender: AgeGenderShare[];
  needsReconsent: boolean;
  loadError: string | null;
}> {
  try {
    const [watch, countries, ageGender] = await Promise.all([
      getChannelWatchSummary(),
      getTopCountries(),
      getAgeGenderShare(),
    ]);
    return {
      watch, countries, ageGender, needsReconsent: false, loadError: null,
    };
  } catch (e) {
    if (e instanceof YouTubeScopeError) {
      return {
        watch: null, countries: [], ageGender: [],
        needsReconsent: true, loadError: null,
      };
    }
    // Non-scope failure (404 channel, 401 token, 5xx outage, missing
    // YouTube Analytics activation, etc.) — surface it in the UI rather
    // than silently rendering nothing. Without this, Yonah sees the
    // basic totals and assumes "deeper analytics is broken" with no clue
    // why. The message comes straight from analyticsQuery's thrown
    // Error and includes the YouTube-supplied reason (insufficientData,
    // youtubeSignupRequired, etc.) so we can diagnose remotely from a
    // screenshot.
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[analytics] non-scope analytics error:', e);
    return {
      watch: null, countries: [], ageGender: [],
      needsReconsent: false, loadError: msg,
    };
  }
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

/**
 * Banner shown above the existing totals/video list when the stored
 * YouTube OAuth token doesn't carry yt-analytics.readonly. The Reconnect
 * link bounces through /api/auth/youtube/start, which already passes
 * prompt=consent so Google re-prompts for the widened scope set.
 */
function ReconnectBanner() {
  return (
    <div
      style={{
        padding: '20px 22px',
        border: '1px solid var(--cedar-400)',
        borderRadius: 'var(--r-lg)',
        background: 'rgba(168, 114, 47, 0.08)',
        marginBottom: 36,
      }}
    >
      <h3
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 500,
          fontSize: '20px',
          letterSpacing: '-0.01em',
          color: 'var(--ink-900)',
          margin: '0 0 6px 0',
          fontVariationSettings: '"opsz" 24, "SOFT" 30',
        }}
      >
        Reconnect YouTube to see deeper analytics
      </h3>
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '14.5px',
          lineHeight: 1.55,
          color: 'var(--ink-500)',
          margin: '0 0 16px 0',
          fontVariationSettings: '"opsz" 16, "SOFT" 50',
          maxWidth: '640px',
        }}
      >
        We added watch-time, geography, and demographic breakdowns. Reconnect
        your YouTube channel once to grant the new permission — your existing
        uploads and posts won&apos;t be affected.
      </p>
      <a
        href="/api/auth/youtube/start"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'var(--ff-body)',
          fontWeight: 500,
          fontSize: '14px',
          padding: '10px 22px',
          minHeight: '40px',
          borderRadius: '999px',
          border: '1px solid var(--cedar-700)',
          background: 'var(--cedar-700)',
          color: 'var(--linen-50)',
          textDecoration: 'none',
        }}
      >
        Reconnect YouTube →
      </a>
    </div>
  );
}

/**
 * Surfaced when loadAnalytics() catches a non-scope error from
 * YouTube Analytics — e.g. youtubeSignupRequired (channel not yet
 * activated in YouTube Studio), accessNotConfigured, quotaExceeded, or
 * a 401 from a stale token. Without this banner the page silently hides
 * the deeper analytics sections and the operator has no idea why.
 *
 * The reconnect link is offered as a last resort even though the error
 * isn't strictly a scope problem — many of these resolve once the user
 * goes through YouTube Studio's analytics setup, and a fresh OAuth
 * round-trip clears stale tokens.
 */
function LoadErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '20px 22px',
        border: '1px solid rgba(192,57,43,.25)',
        borderRadius: 'var(--r-lg)',
        background: 'rgba(192,57,43,.06)',
        marginBottom: 36,
      }}
    >
      <h3
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 500,
          fontSize: '18px',
          letterSpacing: '-0.01em',
          color: 'var(--ink-900)',
          margin: '0 0 6px 0',
          fontVariationSettings: '"opsz" 22, "SOFT" 30',
        }}
      >
        Couldn&apos;t load deeper analytics
      </h3>
      <p
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: '13px',
          lineHeight: 1.55,
          color: 'var(--ink-500)',
          margin: '0 0 14px 0',
          maxWidth: '720px',
        }}
      >
        Watch-time, geography, and demographics couldn&apos;t be fetched from
        YouTube. Reconnecting your channel often clears this — if it
        doesn&apos;t, send the message below to Yitzy.
      </p>
      <code
        style={{
          display: 'block',
          padding: '10px 12px',
          background: 'var(--linen-100)',
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-sm)',
          fontFamily: 'var(--ff-mono, ui-monospace, SFMono-Regular, monospace)',
          fontSize: '12px',
          color: 'var(--ink-700)',
          marginBottom: '14px',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {message}
      </code>
      <a
        href="/api/auth/youtube/start"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'var(--ff-body)',
          fontSize: '13px',
          fontWeight: 500,
          padding: '10px 22px',
          minHeight: '40px',
          borderRadius: '999px',
          border: '1px solid var(--cedar-700)',
          background: 'var(--cedar-700)',
          color: 'var(--linen-50)',
          textDecoration: 'none',
        }}
      >
        Reconnect YouTube →
      </a>
    </div>
  );
}

/**
 * Section heading used by the new analytics cards. Matches the Totals
 * label style (small caps, body font) but at section-header scale.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: 'var(--ff-display)',
        fontWeight: 500,
        fontSize: '22px',
        letterSpacing: '-0.01em',
        color: 'var(--ink-900)',
        margin: '0 0 14px 0',
        fontVariationSettings: '"opsz" 24, "SOFT" 30',
      }}
    >
      {children}
    </h2>
  );
}

/** Three big stats: watch time, avg view duration, views in window. */
function WatchSummaryCards({ watch }: { watch: ChannelWatchSummary }) {
  const cells = [
    { label: 'Watch time', value: formatWatchMinutes(watch.watchTimeMinutes) },
    { label: 'Avg view duration', value: formatSecondsAsMmSs(watch.averageViewDurationSeconds) },
    { label: 'Views (28d)', value: formatNumber(watch.views) },
  ];
  return (
    <div style={{ marginBottom: 36 }}>
      <SectionHeading>Watch summary</SectionHeading>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '14px',
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
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '12.5px',
          color: 'var(--ink-400)',
          margin: '10px 0 0 0',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        Last 28 days.
      </p>
    </div>
  );
}

/**
 * Top countries by view share — bar list. Each row shows country name,
 * view count, and a horizontal bar whose width is its percentage of the
 * total views in the window. Capped at 10 rows.
 */
function GeographyCard({ countries }: { countries: CountryViewShare[] }) {
  const totalViews = countries.reduce((a, c) => a + c.views, 0);
  return (
    <div style={{ marginBottom: 36 }}>
      <SectionHeading>Top countries</SectionHeading>
      <div
        style={{
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-50)',
          overflow: 'hidden',
        }}
      >
        {countries.length === 0 ? (
          <div
            style={{
              padding: '32px',
              textAlign: 'center',
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '14px',
              color: 'var(--ink-400)',
              fontVariationSettings: '"opsz" 16, "SOFT" 50',
            }}
          >
            No geographic data for the last 28 days yet.
          </div>
        ) : (
          countries.map((c, idx) => {
            const pct = totalViews > 0 ? (c.views / totalViews) * 100 : 0;
            return (
              <div
                key={c.countryCode || `row-${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px',
                  gap: '16px',
                  alignItems: 'center',
                  padding: '12px 18px',
                  borderTop: idx === 0 ? 'none' : '1px solid var(--ink-100)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: '12px',
                      marginBottom: '6px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--ff-display)',
                        fontWeight: 500,
                        fontSize: '14.5px',
                        color: 'var(--ink-900)',
                        fontVariationSettings: '"opsz" 16, "SOFT" 30',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {countryName(c.countryCode)}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--ff-display)',
                        fontStyle: 'italic',
                        fontSize: '12px',
                        color: 'var(--ink-400)',
                        fontVariantNumeric: 'tabular-nums',
                        fontVariationSettings: '"opsz" 14, "SOFT" 50',
                        flexShrink: 0,
                      }}
                    >
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: '6px',
                      borderRadius: '999px',
                      background: 'var(--ink-100)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(pct, 2)}%`,
                        height: '100%',
                        background: 'var(--cedar-500)',
                        borderRadius: '999px',
                      }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'var(--ink-900)',
                    textAlign: 'right',
                    fontVariationSettings: '"opsz" 16, "SOFT" 20',
                  }}
                >
                  {formatNumber(c.views)}
                </div>
              </div>
            );
          })
        )}
      </div>
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '12.5px',
          color: 'var(--ink-400)',
          margin: '10px 0 0 0',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        Top {Math.min(countries.length, 10)} by views, last 28 days.
      </p>
    </div>
  );
}

/**
 * Demographics card — small table of age × gender viewer percentages.
 * YouTube returns a row per (ageGroup, gender) combination, with
 * viewerPercentage already normalized so the full grid sums to ~100%.
 * For tiny channels (<100 views per cohort) the API returns no rows;
 * we render an explicit "insufficient data" placeholder in that case.
 */
function DemographicsCard({ ageGender }: { ageGender: AgeGenderShare[] }) {
  // Pivot into rows-by-age, columns-by-gender for an easy-to-scan table.
  const ageOrder = ['age13-17', 'age18-24', 'age25-34', 'age35-44', 'age45-54', 'age55-64', 'age65-'];
  const genderOrder: AgeGenderShare['gender'][] = ['female', 'male', 'user_specified', 'unknown'];

  const matrix = new Map<string, Map<AgeGenderShare['gender'], number>>();
  for (const r of ageGender) {
    if (!matrix.has(r.ageGroup)) matrix.set(r.ageGroup, new Map());
    matrix.get(r.ageGroup)!.set(r.gender, r.viewerPercentage);
  }
  // Only render age buckets the API actually returned, in canonical order.
  const ages = ageOrder.filter((a) => matrix.has(a));
  // Append any unexpected age keys at the end so we don't silently drop them.
  for (const a of matrix.keys()) {
    if (!ages.includes(a)) ages.push(a);
  }
  // Only render gender columns where at least one age bucket has data.
  const presentGenders = genderOrder.filter((g) =>
    ages.some((a) => (matrix.get(a)?.get(g) ?? 0) > 0),
  );

  return (
    <div style={{ marginBottom: 36 }}>
      <SectionHeading>Demographics</SectionHeading>
      <div
        style={{
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-50)',
          overflow: 'hidden',
        }}
      >
        {ageGender.length === 0 || presentGenders.length === 0 ? (
          <div
            style={{
              padding: '32px',
              textAlign: 'center',
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '14px',
              color: 'var(--ink-500)',
              lineHeight: 1.55,
              fontVariationSettings: '"opsz" 16, "SOFT" 50',
            }}
          >
            Insufficient data — demographics need ~100+ views per cohort to populate.
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--ff-display)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 18px',
                    fontFamily: 'var(--ff-body)',
                    fontSize: '10.5px',
                    fontWeight: 500,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-400)',
                    borderBottom: '1px solid var(--ink-100)',
                  }}
                >
                  Age
                </th>
                {presentGenders.map((g) => (
                  <th
                    key={g}
                    style={{
                      textAlign: 'right',
                      padding: '12px 18px',
                      fontFamily: 'var(--ff-body)',
                      fontSize: '10.5px',
                      fontWeight: 500,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-400)',
                      borderBottom: '1px solid var(--ink-100)',
                    }}
                  >
                    {formatGender(g)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ages.map((a, idx) => (
                <tr key={a}>
                  <td
                    style={{
                      padding: '10px 18px',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: 'var(--ink-900)',
                      borderTop: idx === 0 ? 'none' : '1px solid var(--ink-100)',
                      fontVariationSettings: '"opsz" 16, "SOFT" 20',
                    }}
                  >
                    {formatAgeGroup(a)}
                  </td>
                  {presentGenders.map((g) => {
                    const v = matrix.get(a)?.get(g) ?? 0;
                    return (
                      <td
                        key={g}
                        style={{
                          padding: '10px 18px',
                          fontSize: '14px',
                          color: v > 0 ? 'var(--ink-900)' : 'var(--ink-400)',
                          textAlign: 'right',
                          borderTop: idx === 0 ? 'none' : '1px solid var(--ink-100)',
                          fontVariationSettings: '"opsz" 16, "SOFT" 20',
                        }}
                      >
                        {v > 0 ? `${v.toFixed(1)}%` : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '12.5px',
          color: 'var(--ink-400)',
          margin: '10px 0 0 0',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        Viewer percentages, last 28 days.
      </p>
    </div>
  );
}

/**
 * Server component that wraps the analytics loader and renders the new
 * sections. Keeps the heavy fetch path inside its own Suspense boundary
 * so the rest of the page (totals + video list) can stream independently.
 */
async function AnalyticsSections() {
  const { watch, countries, ageGender, needsReconsent, loadError } =
    await loadAnalytics();
  if (needsReconsent) return <ReconnectBanner />;
  if (loadError) return <LoadErrorBanner message={loadError} />;
  if (!watch) return null;
  return (
    <>
      <WatchSummaryCards watch={watch} />
      {/* Channel-wide Geography + Demographics live behind a details
          drawer because they're often empty for small channels (privacy
          floor) and crowd the page once the video list is long. The
          per-video drawer below answers "who watched THIS video"
          directly, which is what Yonah usually wants. */}
      <details
        style={{
          marginBottom: 36,
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-50)',
          padding: '14px 18px',
        }}
      >
        <summary
          style={{
            cursor: 'pointer',
            listStyle: 'none',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '16px',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 18, "SOFT" 30',
          }}
        >
          <span>Audience across all videos</span>
          <span
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '12.5px',
              color: 'var(--ink-400)',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
            }}
          >
            country · age × gender · last 28d
          </span>
        </summary>
        <div style={{ marginTop: 18 }}>
          <GeographyCard countries={countries} />
          <DemographicsCard ageGender={ageGender} />
        </div>
      </details>
    </>
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
      <VideoAnalyticsRows videos={videos} />
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

      {/* Watch summary, geography, demographics — wrapped in their own
          Suspense boundary so a slow Analytics API response doesn't
          delay the totals + video list below. */}
      <Suspense fallback={null}>
        <AnalyticsSections />
      </Suspense>

      <Suspense fallback={<VideoListSkeleton />}>
        <VideoList />
      </Suspense>
    </div>
  );
}
