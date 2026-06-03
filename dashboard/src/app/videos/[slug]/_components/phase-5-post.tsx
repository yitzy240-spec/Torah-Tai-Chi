// dashboard/src/app/videos/[slug]/_components/phase-5-post.tsx
//
// Phase 5 assembly: stacks platform cards in fixed order (Site, Instagram, YouTube, Facebook, X).
// Hides any platform NOT in connectedPlatforms (except Site, which is always shown).
// Top: "Posted X of Y" progress strip with useRealtimeRows so the count updates live.
// Includes "Post all" button for platforms with draft captions.
// Bottom: "← Back to stitched video" link.
//
// Receives serializable props from the server component wrapper (phase-5-post-connected.tsx).

'use client';
import { useState } from 'react';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';
import { postAllPlatforms } from '@/app/actions/video-page/post-all-platforms';
import { BottomSheet } from './bottom-sheet';
import { SiteCard } from './posting-cards/site-card';
import { InstagramCard } from './posting-cards/instagram-card';
import { YouTubeCard } from './posting-cards/youtube-card';
import { FacebookCard } from './posting-cards/facebook-card';
import { XCard } from './posting-cards/x-card';
import { PLATFORM_DISPLAY, type Platform } from '@/lib/platforms';

interface PostRow {
  id: string;
  platform: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  published_at: string | null;
  buffer_update_id: string | null;
  caption: string | null;
  error_message: string | null;
}

interface SocialMeta {
  instagram?: { type: 'reel' | 'post'; firstComment?: string };
  facebook?: { type: 'reel' | 'post'; firstComment?: string };
}

interface Props {
  // Site card
  videoId: string;
  parshaSlug: string;
  isLive: boolean;
  liveSince: string | null;
  liveVersionLabel: string | null;
  siteTitle: string;
  siteSubtitle: string;
  siteDescription: string;
  websiteUrl: string;
  onSiteReplace: () => void;

  // Job + captions
  jobId: string;
  captions: Record<string, string>;       // flat map from plan_json.captions
  youtubeTags: string[];
  socialMetadata: SocialMeta | null;

  // Posts (initial snapshot; Realtime keeps them live)
  initialPosts: PostRow[];
  postUrls: Record<string, string>;      // platform -> external URL

  // Connected platforms (site is always shown separately)
  connectedPlatforms: Platform[];

  // Video URL for frame picker
  videoMp4Url: string | null;
  thumbPath: string | null;
  /** Persisted YouTube cover-frame pick (videos.youtube_thumbnail_url).
   *  Passed to YouTubeCard.initialPickedThumbUrl so a reload doesn't
   *  drop the pick, and forwarded through Post all → postAllPlatforms
   *  so the fanout path also ships with the operator's frame. */
  youtubeThumbnailUrl: string | null;

  // Navigation
  onBack: () => void;
}

export function Phase5Post(p: Props) {
  const [postAllOpen, setPostAllOpen] = useState(false);
  const [postAllLoading, setPostAllLoading] = useState(false);

  // Live-update posts from Supabase Realtime (filtered by video_id).
  const posts = useRealtimeRows<PostRow>('posts', 'video_id', p.videoId, p.initialPosts);

  // Dedupe: keep the latest post per platform.
  const latestPostByPlatform: Record<string, PostRow> = {};
  for (const post of [...posts].sort((a, b) => a.created_at < b.created_at ? -1 : 1)) {
    latestPostByPlatform[post.platform] = post;
  }

  // Progress strip
  const socialPlatforms = p.connectedPlatforms;
  const totalPlatforms = 1 + socialPlatforms.length; // 1 = Site
  const sitePosted = p.isLive ? 1 : 0;
  const socialPosted = socialPlatforms.filter(
    (pl) => latestPostByPlatform[pl]?.status === 'published',
  ).length;
  const totalPosted = sitePosted + socialPosted;

  const isConnected = (pl: Platform) => p.connectedPlatforms.includes(pl);

  const captionFor = (key: string): string =>
    p.captions[key] ?? '';

  // For the Post-all confirm sheet, surface a short caption preview per
  // platform so Yonah can see what's actually about to ship before he
  // pulls the trigger. YouTube's user-facing "caption" is the title
  // (description is long-form metadata); every other platform uses its
  // own caption key as-is.
  const previewCaptionFor = (pl: Platform): string => {
    const raw = pl === 'youtube' ? captionFor('youtube_title') : captionFor(pl);
    const trimmed = raw.trim();
    return trimmed.length > 80 ? `${trimmed.slice(0, 80).trim()}…` : trimmed;
  };

  // Platforms with draft captions that haven't been posted yet.
  // Use previewCaptionFor so YouTube (caption lives under 'youtube_title',
  // not 'youtube') isn't silently dropped — pre-fix the raw p.captions['youtube']
  // lookup evaluated to undefined and YouTube was excluded from Post-all.
  const remaining = socialPlatforms.filter(
    (pl) => previewCaptionFor(pl) && !latestPostByPlatform[pl]?.status?.startsWith('publish'),
  );

  const handlePostAll = async () => {
    setPostAllLoading(true);
    try {
      const result = await postAllPlatforms({
        videoId: p.videoId,
        captions: p.captions,
        platforms: remaining,
        shareNow: true,
        // Forward the operator's persisted YouTube cover-frame pick.
        // postAllPlatforms passes it through to autoPost which overrides
        // the auto-extracted thumb at videos.thumb_path for the YouTube
        // upload. Undefined = no pick (autoPost falls back to thumb_path).
        youtubeThumbnailUrl: p.youtubeThumbnailUrl ?? undefined,
      });

      if (result.errors && result.errors.length > 0 && (!result.results || result.results.length === 0)) {
        // All platforms failed
        console.error('Post all failed:', result.errors);
      }
      // Realtime will update the posts; no explicit state update needed
    } catch (e) {
      console.error('Error posting all platforms:', e);
    } finally {
      setPostAllLoading(false);
      setPostAllOpen(false);
    }
  };

  return (
    <section>
      {/* Progress strip with Post all button */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 14px',
        background: 'var(--linen-50)',
        border: '1px solid var(--ink-100)',
        borderRadius: 10,
        fontSize: 13,
        marginBottom: 16,
        gap: 12,
      }}>
        <span>
          <strong>Posted: {totalPosted} of {totalPlatforms}</strong>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {remaining.length > 0 && (
            <button
              type="button"
              onClick={() => setPostAllOpen(true)}
              disabled={postAllLoading}
              style={{
                minHeight: 32,
                minWidth: 120,
                fontSize: 13,
                fontWeight: 500,
                background: postAllLoading ? 'var(--ink-300)' : 'var(--navy-700)',
                color: 'var(--linen-50)',
                border: 'none',
                borderRadius: 8,
                padding: '8px 12px',
                cursor: postAllLoading ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {postAllLoading
                ? 'Posting...'
                : `Post to all ${remaining.length} platform${remaining.length === 1 ? '' : 's'}…`}
            </button>
          )}
          <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
            {totalPosted >= totalPlatforms ? 'All done!' : `${totalPlatforms - totalPosted} remaining`}
          </span>
        </div>
      </div>

      {/* Post-all confirmation sheet.
          Renders a per-platform caption preview so Yonah can verify what
          actually ships before publishing live. Mirrors the channel-row
          markup pattern from schedule-all-sheet.tsx (the canonical
          template). primaryAction.destructive flips the CTA red because
          this is the single most consequential action in the app —
          publishing to every connected live account in one tap. */}
      <BottomSheet
        open={postAllOpen}
        onOpenChange={setPostAllOpen}
        title={`Post to all ${remaining.length} platform${remaining.length === 1 ? '' : 's'}?`}
        primaryAction={{
          label: postAllLoading
            ? 'Posting...'
            : `Post to ${remaining.length} platform${remaining.length === 1 ? '' : 's'} now`,
          onClick: handlePostAll,
          destructive: true,
        }}
        secondaryAction={{
          label: 'Cancel',
          onClick: () => setPostAllOpen(false),
        }}
      >
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {remaining.map((pl) => {
            const preview = previewCaptionFor(pl);
            return (
              <li
                key={pl}
                style={{
                  borderTop: '1px solid var(--ink-100)',
                  padding: '10px 0',
                  fontSize: 12.5,
                }}
              >
                <span
                  style={{
                    fontWeight: 500,
                    color: 'var(--ink-900)',
                    display: 'block',
                    marginBottom: 2,
                  }}
                >
                  {PLATFORM_DISPLAY[pl]}
                </span>
                <span
                  style={{
                    color: 'var(--ink-600)',
                    fontStyle: preview ? 'normal' : 'italic',
                    display: 'block',
                  }}
                >
                  {preview || '(no caption set)'}
                </span>
              </li>
            );
          })}
        </ul>
      </BottomSheet>

      {/* Site card — always shown */}
      <SiteCard
        videoId={p.videoId}
        parshaSlug={p.parshaSlug}
        isLive={p.isLive}
        liveSince={p.liveSince}
        liveVersionLabel={p.liveVersionLabel}
        title={p.siteTitle}
        subtitle={p.siteSubtitle}
        description={p.siteDescription}
        websiteUrl={p.websiteUrl}
        onReplace={p.onSiteReplace}
      />

      {/* TikTok card removed 2026-05-28: platform swapped out for Facebook.
          See ACTIVE_PLATFORMS in lib/platforms.ts. */}

      {/* Instagram card */}
      {isConnected('instagram') && (
        <InstagramCard
          jobId={p.jobId}
          videoId={p.videoId}
          parshaSlug={p.parshaSlug}
          caption={captionFor('instagram')}
          post={latestPostByPlatform['instagram'] ?? null}
          postUrl={p.postUrls['instagram'] ?? null}
          socialMetadata={p.socialMetadata}
        />
      )}

      {/* YouTube card */}
      {isConnected('youtube') && (
        <YouTubeCard
          jobId={p.jobId}
          videoId={p.videoId}
          parshaSlug={p.parshaSlug}
          youtubeTitle={captionFor('youtube_title')}
          youtubeDescription={captionFor('youtube_description')}
          youtubeTags={p.youtubeTags}
          post={latestPostByPlatform['youtube'] ?? null}
          postUrl={p.postUrls['youtube'] ?? null}
          videoMp4Url={p.videoMp4Url}
          initialThumbUrl={p.thumbPath}
          initialPickedThumbUrl={p.youtubeThumbnailUrl}
        />
      )}

      {/* Facebook card */}
      {isConnected('facebook') && (
        <FacebookCard
          jobId={p.jobId}
          videoId={p.videoId}
          parshaSlug={p.parshaSlug}
          caption={captionFor('facebook')}
          post={latestPostByPlatform['facebook'] ?? null}
          postUrl={p.postUrls['facebook'] ?? null}
          socialMetadata={p.socialMetadata}
        />
      )}

      {/* X card */}
      {isConnected('twitter') && (
        <XCard
          jobId={p.jobId}
          videoId={p.videoId}
          parshaSlug={p.parshaSlug}
          caption={captionFor('twitter')}
          post={latestPostByPlatform['twitter'] ?? null}
          postUrl={p.postUrls['twitter'] ?? null}
        />
      )}

      {/* Back link */}
      <div style={{ marginTop: 14, padding: '12px 0', borderTop: '1px solid var(--ink-100)' }}>
        <button
          type="button"
          onClick={p.onBack}
          style={{ background: 'none', border: 'none', color: 'var(--ink-500)', textDecoration: 'underline', fontSize: 13, cursor: 'pointer', minHeight: 44 }}
        >
          Back to stitched video
        </button>
      </div>
    </section>
  );
}
