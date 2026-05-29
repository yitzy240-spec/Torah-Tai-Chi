// dashboard/src/app/page.tsx
//
// Dashboard landing page. Legacy Today + cookie-based dispatcher
// removed 2026-05-29 (Yonah shipped his first video on the new flow,
// cutover permanent).
//
// Layout (top to bottom):
//   1. Latest live video card — most recently published_to_website=true video
//   2. "Start working on next video" — 4-card picker
//
// All data is server-fetched. Client interaction lives in StartNextVideoPicker.

import { Suspense } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getThisWeekParsha, getUpcomingWeeks, getUpcomingHolidays, HEBCAL_TO_SLUG } from '@/lib/hebcal';
import { publicVideoUrl } from '@/lib/storage-url';
import { ACTIVE_PLATFORMS } from '@/lib/platforms';
import { StartNextVideoPicker } from '@/components/start-next-video-picker';
import { PlatformIcon } from '@/components/platform-icon';

// ─── Types ──────────────────────────────────────────────────────────────────

type ParshaOption = {
  id: string;
  slug: string;
  name: string;
  book: string;
  order: number;
};

type UpcomingParshaProps = {
  id: string;
  slug: string;
  name: string;
  book: string;
  shabbatDate: string | null;
  hebrew: string | null;
  /** true when the parsha IS this coming Shabbat; false = next available weekly parsha */
  isThisShabbat: boolean;
};

type LatestLiveVideo = {
  videoId: string;
  thumbUrl: string | null;
  parshaName: string;
  parshaSlug: string;
  displayTitle: string | null;
  description: string | null;
  liveSince: string | null;
  /** Lowercase platform slugs the video has been published to
   *  (filtered to ACTIVE_PLATFORMS in render order). Drives the
   *  small badge row under the title. */
  postedPlatforms: string[];
  /** Public website URL — drives the "View on torahtaichi.com"
   *  secondary link inside the card. */
  websiteUrl: string;
};

// ─── Data fetchers ──────────────────────────────────────────────────────────

async function getLatestLiveVideo(): Promise<LatestLiveVideo | null> {
  const supabase = await createClient();

  // Two queries instead of a PostgREST embed. The embed
  // parshiot!inner(name, slug) was the same pattern that silently
  // failed in production earlier (Server-Components render error,
  // 2026-05-26) on clips→jobs and clip_plans→jobs. Yonah 2026-05-28:
  // "the main video page is not showing the new video or even the
  // Shavuot video" — likely the embed schema-cache resolution failing
  // again, returning null and hiding the Latest live card entirely.
  const { data: vRow } = await supabase
    .from('videos')
    .select('id, parsha_id, thumb_path, title, subtitle, description, created_at')
    .eq('published_to_website', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!vRow) return null;

  let parshaName = 'Unknown';
  let parshaSlug = '';
  if (vRow.parsha_id) {
    const { data: pRow } = await supabase
      .from('parshiot')
      .select('name, slug')
      .eq('id', vRow.parsha_id as string)
      .maybeSingle();
    if (pRow) {
      parshaName = (pRow.name as string) ?? 'Unknown';
      parshaSlug = (pRow.slug as string) ?? '';
    }
  }

  // Which active platforms is the video actually live on? Operators
  // wanted the Today card to surface this at a glance instead of
  // having to click into the video page to find out (Yonah 2026-05-29).
  const { data: postRows } = await supabase
    .from('posts')
    .select('platform')
    .eq('video_id', vRow.id as string)
    .eq('status', 'published');
  const postedSet = new Set((postRows ?? []).map((r) => r.platform as string));
  // Preserve ACTIVE_PLATFORMS render order — IG/YT/FB/X — so the icon
  // row reads the same on every card.
  const postedPlatforms = ACTIVE_PLATFORMS.filter((p) => postedSet.has(p));

  return {
    videoId: vRow.id as string,
    thumbUrl: vRow.thumb_path ? publicVideoUrl(vRow.thumb_path as string) : null,
    parshaName,
    parshaSlug,
    // videos.subtitle holds the creative title (snapshotted from scripts.title
    // at stitch); videos.title is the parsha name. See migration
    // 20260517_video_page_redesign.sql.
    displayTitle: (vRow.subtitle as string | null) ?? (vRow.title as string | null) ?? null,
    description: (vRow.description as string | null) ?? null,
    liveSince: (vRow.created_at as string | null) ?? null,
    postedPlatforms: [...postedPlatforms],
    websiteUrl: `https://torahtaichi.com/${parshaSlug}`,
  };
}

async function getAllParshiot(): Promise<ParshaOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('parshiot')
    .select('id, slug, name, book, order')
    .order('order', { ascending: true });
  return (data ?? []) as ParshaOption[];
}

async function resolveUpcomingParsha(): Promise<UpcomingParshaProps | null> {
  // Try this Shabbat first.
  const thisWeek = await getThisWeekParsha();
  const hebcal = thisWeek ?? (await getUpcomingWeeks(6)).find(Boolean) ?? null;
  if (!hebcal) return null;

  const isThisShabbat = hebcal === thisWeek;

  const supabase = await createClient();
  const { data } = await supabase
    .from('parshiot')
    .select('id, slug, name, book')
    .eq('slug', hebcal.slug)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    book: data.book as string,
    shabbatDate: hebcal.shabbatDate,
    hebrew: hebcal.hebrew ?? null,
    isThisShabbat,
  };
}

async function resolveUpcomingHoliday(): Promise<{
  id: string;
  slug: string;
  name: string;
  days: number;
} | null> {
  const holidays = await getUpcomingHolidays(30);
  if (holidays.length === 0) return null;

  const supabase = await createClient();
  const slugs = holidays.map((h) => h.slug);

  // Fetch seeded parshiot rows for these holiday slugs.
  const { data: rows } = await supabase
    .from('parshiot')
    .select('id, slug')
    .in('slug', slugs);

  const seeded = new Map((rows ?? []).map((r) => [r.slug as string, r.id as string]));

  // Fetch parsha_ids that already have a published-to-website video so we can skip them.
  const seededIds = Array.from(seeded.values());
  const { data: liveRows } = seededIds.length > 0
    ? await supabase
        .from('videos')
        .select('parsha_id')
        .in('parsha_id', seededIds)
        .eq('published_to_website', true)
    : { data: [] };

  const alreadyLiveIds = new Set((liveRows ?? []).map((r) => r.parsha_id as string));

  const today = new Date().toISOString().slice(0, 10);

  for (const h of holidays) {
    const id = seeded.get(h.slug);
    if (!id) continue;
    // Skip holidays that already have a live published video.
    if (alreadyLiveIds.has(id)) continue;
    const days = Math.round(
      (new Date(h.date + 'T12:00:00').getTime() -
        new Date(today + 'T12:00:00').getTime()) /
        86400000,
    );
    return { id, slug: h.slug, name: h.name, days };
  }
  return null;
}

// ─── Latest live video card ─────────────────────────────────────────────────

function LatestLiveCard({
  video,
  v2Suffix,
}: {
  video: LatestLiveVideo;
  v2Suffix: string;
}) {
  const liveSince = video.liveSince
    ? new Date(video.liveSince).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    : null;

  return (
    <section
      style={{
        marginBottom: '48px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: '10.5px',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--cedar-600)',
          marginBottom: '12px',
        }}
      >
        Latest live video
      </div>

      <Link
        href={`/videos/${video.parshaSlug}${v2Suffix}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '16px 20px',
          border: '1.5px solid var(--ink-100)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-50)',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all var(--trans)',
          boxShadow: 'var(--shadow-quiet)',
          minHeight: '44px',
        }}
        className="latest-live-card"
      >
        {/* Thumbnail */}
        {video.thumbUrl ? (
          <div
            style={{
              width: '72px',
              height: '128px',
              borderRadius: '6px',
              overflow: 'hidden',
              flexShrink: 0,
              background: 'var(--ink-100)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={video.thumbUrl}
              alt={`Thumbnail for ${video.parshaName}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: '72px',
              height: '128px',
              borderRadius: '6px',
              background: 'var(--ink-100)',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--ink-300)',
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '11px',
            }}
          >
            —
          </div>
        )}

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--ff-body)',
              fontSize: '10.5px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--cedar-600)',
              marginBottom: '4px',
            }}
          >
            Parashat {video.parshaName}
          </div>

          {video.displayTitle && (
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontWeight: 500,
                fontSize: '18px',
                color: 'var(--ink-900)',
                letterSpacing: '-0.015em',
                fontVariationSettings: '"opsz" 20, "SOFT" 30',
                marginBottom: '6px',
                lineHeight: 1.2,
              }}
            >
              {video.displayTitle}
            </div>
          )}

          {video.description && (
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '13px',
                color: 'var(--ink-500)',
                lineHeight: 1.4,
                marginBottom: '8px',
                fontVariationSettings: '"opsz" 14, "SOFT" 50',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {video.description}
            </div>
          )}

          {/* Status row: LIVE pill + posted-on platform icons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
          {liveSince && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 8px',
                borderRadius: '20px',
                background: 'rgba(90,110,61,.1)',
                fontFamily: 'var(--ff-body)',
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--jade)',
                letterSpacing: '0.03em',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--jade)',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              LIVE since {liveSince}
            </div>
          )}

          {/* Posted-on icons — IG/YT/FB/X badges. Each shows when the
              video has a published post on that platform. Operator
              scans this to see distribution at a glance. */}
          {video.postedPlatforms.length > 0 && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--ink-500)',
              }}
              aria-label={`Posted on ${video.postedPlatforms.join(', ')}`}
              title={`Posted on ${video.postedPlatforms.join(', ')}`}
            >
              {video.postedPlatforms.map((pl) => (
                <PlatformIcon
                  key={pl}
                  name={pl as 'instagram' | 'youtube' | 'facebook' | 'twitter'}
                  size={14}
                />
              ))}
            </div>
          )}
          </div>
        </div>

        {/* Arrow */}
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13px',
            color: 'var(--navy-700)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          Open →
        </div>
      </Link>
    </section>
  );
}

// ─── Skeleton for Suspense ──────────────────────────────────────────────────

function PickerSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{
        fontFamily: 'var(--ff-display)',
        fontStyle: 'italic',
        fontSize: '14px',
        color: 'var(--ink-300)',
        padding: '20px 0',
        fontVariationSettings: '"opsz" 14, "SOFT" 50',
      }}
    >
      Loading…
    </div>
  );
}

// ─── Async data loader (inner server component) ─────────────────────────────

async function PickerData({ v2Suffix }: { v2Suffix: string }) {
  const [upcomingParsha, upcomingHoliday, allParshiot] = await Promise.all([
    resolveUpcomingParsha(),
    resolveUpcomingHoliday(),
    getAllParshiot(),
  ]);

  return (
    <StartNextVideoPicker
      upcomingParsha={upcomingParsha}
      upcomingHoliday={upcomingHoliday}
      allParshiot={allParshiot}
      v2Suffix={v2Suffix}
    />
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

interface DashboardLandingNewProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DashboardLandingNew({ searchParams }: DashboardLandingNewProps) {
  const sp = await searchParams;

  // Preserve the v2 override in deep links so Yonah stays on the new page
  // when navigating from the landing to a video detail page.
  const v2Param = typeof sp.v2 === 'string' ? sp.v2 : null;
  const v2Suffix = v2Param === '1' ? '?v2=1' : '';

  const latestLive = await getLatestLiveVideo();

  // Suppress the "possibly-null" for HEBCAL_TO_SLUG — it's imported but may
  // be unused in this file. We import it purely to satisfy the module graph
  // (hebcal.ts co-exports it with the functions we use).
  void HEBCAL_TO_SLUG;

  return (
    <div className="stagger">
      {/* ── Latest live video ──────────────────────────────────────────── */}
      {latestLive && (
        <LatestLiveCard video={latestLive} v2Suffix={v2Suffix} />
      )}

      {/* ── Start next video picker ─────────────────────────────────────── */}
      <Suspense fallback={<PickerSkeleton />}>
        <PickerData v2Suffix={v2Suffix} />
      </Suspense>
    </div>
  );
}
