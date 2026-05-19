// dashboard/src/app/videos/[slug]/_components/phase-5-post.tsx
//
// Phase 5 assembly: stacks platform cards in fixed order (Site, TikTok, Instagram, YouTube, Facebook, X).
// Hides any platform NOT in connectedPlatforms (except Site, which is always shown).
// Top: "Posted X of Y" progress strip with useRealtimeRows so the count updates live.
// Bottom: "← Back to stitched video" link.
//
// Receives serializable props from the server component wrapper (phase-5-post-connected.tsx).

'use client';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';
import { SiteCard } from './posting-cards/site-card';
import { TikTokCard } from './posting-cards/tiktok-card';
import { InstagramCard } from './posting-cards/instagram-card';
import { YouTubeCard } from './posting-cards/youtube-card';
import { FacebookCard } from './posting-cards/facebook-card';
import { XCard } from './posting-cards/x-card';
import type { Platform } from '@/lib/platforms';

interface PostRow {
  id: string;
  platform: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  buffer_update_id: string | null;
  caption: string | null;
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

  // Navigation
  onBack: () => void;
}

export function Phase5Post(p: Props) {
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

  return (
    <section>
      {/* Progress strip */}
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
      }}>
        <span>
          <strong>Posted: {totalPosted} of {totalPlatforms}</strong>
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
          {totalPosted >= totalPlatforms ? 'All done!' : `${totalPlatforms - totalPosted} remaining`}
        </span>
      </div>

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

      {/* TikTok card */}
      {isConnected('tiktok') && (
        <TikTokCard
          jobId={p.jobId}
          videoId={p.videoId}
          parshaSlug={p.parshaSlug}
          caption={captionFor('tiktok')}
          post={latestPostByPlatform['tiktok'] ?? null}
          postUrl={p.postUrls['tiktok'] ?? null}
        />
      )}

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
