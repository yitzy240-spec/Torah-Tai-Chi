// dashboard/src/app/videos/[slug]/_components/live-at-rest.tsx
//
// Renders the calm status display per spec §5.1 when a live version exists
// and no draft is in progress ("live-at-rest" state).
//
// B2 expansion — layout top-to-bottom:
//   1. Hero strip: video player + LIVE pill + display title + parsha attribution.
//   2. Site CMS card: 5 editable fields + "Publish changes" + "Unpublish".
//   3. Per-platform cards (Phase 5 cards in their "posted" state — published only).
//   4. Footer: "Download mp4" + "Replace with a new version".
//
// "Replace" opens a BottomSheet confirm per spec §5.4; confirm calls onReplace.

'use client';
import { useState } from 'react';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';
import { BottomSheet } from './bottom-sheet';
import { LiveSiteCmsCard } from './live-site-cms-card';
import { TikTokCard } from './posting-cards/tiktok-card';
import { InstagramCard } from './posting-cards/instagram-card';
import { YouTubeCard } from './posting-cards/youtube-card';
import { FacebookCard } from './posting-cards/facebook-card';
import { XCard } from './posting-cards/x-card';
import { PlatformIcon } from '@/components/platform-icon';
import type { Platform } from '@/lib/platforms';

export interface PlatformStatus {
  platform: string;
  postedAt: string | null;
  postUrl: string | null;
  viewsLabel: string | null;
}

export interface LiveAtRestPost {
  id: string;
  platform: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  published_at: string | null;
  buffer_update_id: string | null;
  caption: string | null;
}

interface SocialMeta {
  instagram?: { type: 'reel' | 'post'; firstComment?: string };
  facebook?: { type: 'reel' | 'post'; firstComment?: string };
}

interface Props {
  parshaName: string;
  versionLabel: string;             // e.g. "v2"
  videoMp4Url: string;
  thumbPath: string | null;
  websiteUrl: string;
  /** The BIG heading — the creative script title ("In the Desert…") */
  displayTitle: string;
  /** The smaller attribution line — the parsha name ("Bamidbar") */
  attribution: string;
  publishedToWebsiteSince: string | null;
  platforms: PlatformStatus[];      // includes website row + social rows
  onReplace: () => void;

  // B2: video ID (for Realtime subscription + CMS card)
  videoId: string;
  parshaSlug: string;

  // B2: site CMS fields
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  siteWebsiteCaption: string;
  siteSpokenScript: string;

  // B2: per-platform cards
  liveJobId: string | null;
  captions: Record<string, string>;
  youtubeTags: string[];
  socialMetadata: SocialMeta | null;
  initialPosts: LiveAtRestPost[];
  postUrls: Record<string, string>;
  connectedPlatforms: Platform[];
}

export function LiveAtRest(p: Props) {
  const [confirmReplace, setConfirmReplace] = useState(false);

  // Live-update posts from Supabase Realtime (same pattern as Phase5Post)
  const posts = useRealtimeRows<LiveAtRestPost>('posts', 'video_id', p.videoId, p.initialPosts);

  // Dedupe: keep the latest post per platform
  const latestPostByPlatform: Record<string, LiveAtRestPost> = {};
  for (const post of [...posts].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    latestPostByPlatform[post.platform] = post;
  }

  // Only show cards for platforms that have a published post.
  // On the live page we show any platform that has a published post — we do NOT
  // gate on connectedPlatforms because a platform may have been posted to before
  // its Buffer token expired, or simply because the live page is a status display
  // and should always show what actually got posted.
  const postedPlatforms = new Set(
    Object.entries(latestPostByPlatform)
      .filter(([, post]) => post.status === 'published')
      .map(([platform]) => platform),
  );

  const hasPostedPost = (pl: Platform | 'twitter') => postedPlatforms.has(pl);

  const captionFor = (key: string): string => p.captions[key] ?? '';

  const jobId = p.liveJobId ?? '';

  // Show the social section when there are published posts, regardless of jobId.
  // jobId may be null for legacy videos posted before the job pipeline was set up,
  // but they may still have posts.
  const showSocialSection = postedPlatforms.size > 0;

  return (
    <section style={{ width: '100%' }}>
      {/* ------------------------------------------------------------ */}
      {/* 1. Hero strip: video left, LIVE pill + title + attribution right */}
      {/* ------------------------------------------------------------ */}
      <div
        style={{
          display: 'flex',
          gap: 18,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          marginBottom: 20,
        }}
      >
        {/* Video player */}
        <video
          src={p.videoMp4Url}
          poster={p.thumbPath ?? undefined}
          controls
          playsInline
          style={{
            width: 200,
            maxWidth: '100%',
            aspectRatio: '9/16',
            borderRadius: 8,
            background: 'var(--ink-900)',
            flexShrink: 0,
          }}
        />

        {/* Right-side info */}
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          {/* LIVE pill */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: 'rgba(46,125,94,.12)',
              color: 'var(--jade)',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--jade)',
                display: 'inline-block',
              }}
            />
            LIVE
            {p.publishedToWebsiteSince
              ? ` since ${new Date(p.publishedToWebsiteSince).toLocaleDateString()}`
              : ''}
          </span>

          {/* Headline (creative title) + attribution (parsha name) */}
          <h2
            style={{
              margin: '0 0 4px',
              fontFamily: 'var(--ff-display)',
              fontSize: 22,
              lineHeight: 1.2,
              color: 'var(--ink-900)',
            }}
          >
            {p.displayTitle || p.parshaName}
          </h2>
          <p
            style={{
              margin: '0 0 16px',
              color: 'var(--ink-500)',
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {p.attribution}
          </p>

          {/* Per-channel list — top-bar styling, one row per channel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {p.platforms.map((pl) => {
              const isPosted = pl.postedAt !== null;
              const isSite = pl.platform === 'torahtaichi.com';
              const platformKey = isSite
                ? 'website'
                : (pl.platform === 'twitter' ? 'twitter' : pl.platform) as 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'twitter' | 'website';
              const displayName = isSite
                ? 'torahtaichi.com'
                : pl.platform === 'twitter'
                  ? 'X'
                  : pl.platform.charAt(0).toUpperCase() + pl.platform.slice(1);
              const verb = isSite ? 'live since' : 'posted';
              return (
                <div
                  key={pl.platform}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    background: 'var(--linen-50)',
                    border: '1px solid var(--jade)',
                    borderRadius: 'var(--r-md)',
                    fontSize: 13,
                    color: isPosted ? 'var(--ink-900)' : 'var(--ink-400)',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: isPosted ? 'var(--jade)' : 'var(--ink-200)',
                      flexShrink: 0,
                      display: 'inline-block',
                    }}
                  />
                  <PlatformIcon name={platformKey} size={14} />
                  <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 500 }}>{displayName}</span>
                    {isPosted && (
                      <span style={{ color: 'var(--ink-500)', fontSize: 12 }}>
                        · {verb} {new Date(pl.postedAt!).toLocaleDateString()}
                      </span>
                    )}
                    {!isPosted && (
                      <span style={{ color: 'var(--ink-400)', fontSize: 12 }}>· not posted</span>
                    )}
                  </span>
                  {pl.postUrl && (
                    <a
                      href={pl.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: 'var(--navy-700)',
                        textDecoration: 'underline',
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        marginLeft: 'auto',
                      }}
                    >
                      {pl.viewsLabel ?? 'View'} →
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* 2. Site CMS card — 5 editable fields + Publish changes / Unpublish */}
      {/* ------------------------------------------------------------ */}
      <LiveSiteCmsCard
        videoId={p.videoId}
        parshaSlug={p.parshaSlug}
        websiteUrl={p.websiteUrl}
        liveSince={p.publishedToWebsiteSince}
        title={p.siteTitle}
        subtitle={p.siteSubtitle}
        description={p.siteDescription}
        websiteCaption={p.siteWebsiteCaption}
        spokenScript={p.siteSpokenScript}
      />

      {/* ------------------------------------------------------------ */}
      {/* 3. Per-platform posted cards (Phase 5 cards, posted state only) */}
      {/* ------------------------------------------------------------ */}
      {showSocialSection && (
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--ink-500)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 10,
            }}
          >
            Social platforms
          </div>

          {hasPostedPost('tiktok') && (
            <TikTokCard
              jobId={jobId}
              videoId={p.videoId}
              parshaSlug={p.parshaSlug}
              caption={captionFor('tiktok')}
              post={latestPostByPlatform['tiktok'] ?? null}
              postUrl={p.postUrls['tiktok'] ?? null}
            />
          )}

          {hasPostedPost('instagram') && (
            <InstagramCard
              jobId={jobId}
              videoId={p.videoId}
              parshaSlug={p.parshaSlug}
              caption={captionFor('instagram')}
              post={latestPostByPlatform['instagram'] ?? null}
              postUrl={p.postUrls['instagram'] ?? null}
              socialMetadata={p.socialMetadata}
            />
          )}

          {hasPostedPost('youtube') && (
            <YouTubeCard
              jobId={jobId}
              videoId={p.videoId}
              parshaSlug={p.parshaSlug}
              youtubeTitle={captionFor('youtube_title')}
              youtubeDescription={captionFor('youtube_description')}
              youtubeTags={p.youtubeTags}
              post={latestPostByPlatform['youtube'] ?? null}
              postUrl={p.postUrls['youtube'] ?? null}
              videoMp4Url={p.videoMp4Url}
              initialThumbUrl={p.thumbPath}
            />
          )}

          {hasPostedPost('facebook') && (
            <FacebookCard
              jobId={jobId}
              videoId={p.videoId}
              parshaSlug={p.parshaSlug}
              caption={captionFor('facebook')}
              post={latestPostByPlatform['facebook'] ?? null}
              postUrl={p.postUrls['facebook'] ?? null}
              socialMetadata={p.socialMetadata}
            />
          )}

          {/* X platform key is 'twitter' in the DB */}
          {hasPostedPost('twitter') && (
            <XCard
              jobId={jobId}
              videoId={p.videoId}
              parshaSlug={p.parshaSlug}
              caption={captionFor('twitter')}
              post={latestPostByPlatform['twitter'] ?? null}
              postUrl={p.postUrls['twitter'] ?? null}
            />
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ */}
      {/* 4. Footer: download + replace */}
      {/* ------------------------------------------------------------ */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 14,
          borderTop: '1px solid var(--ink-100)',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <a
          href={p.videoMp4Url}
          download
          style={{
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 14px',
            fontSize: 13,
            color: 'var(--ink-500)',
            textDecoration: 'underline',
          }}
        >
          Download mp4
        </a>
        <button
          type="button"
          onClick={() => setConfirmReplace(true)}
          style={{
            minHeight: 44,
            fontSize: 13,
            fontWeight: 500,
            background: 'white',
            color: 'var(--navy-700)',
            border: '1px solid var(--navy-700)',
            borderRadius: 8,
            padding: '0 16px',
            cursor: 'pointer',
          }}
        >
          Replace with a new version
        </button>
      </div>

      {/* Replace confirm bottom-sheet per spec §5.4 */}
      <BottomSheet
        open={confirmReplace}
        onOpenChange={setConfirmReplace}
        title={`Start a new draft of ${p.parshaName}?`}
        primaryAction={{
          label: 'Start a new draft',
          onClick: () => {
            setConfirmReplace(false);
            p.onReplace();
          },
          destructive: true,
        }}
        secondaryAction={{
          label: 'Cancel',
          onClick: () => setConfirmReplace(false),
        }}
      >
        {p.versionLabel} stays live on torahtaichi.com + the social platforms until you publish
        the new one. The new draft starts from the same script — you can change it.
      </BottomSheet>
    </section>
  );
}
