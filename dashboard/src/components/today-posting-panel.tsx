'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PlatformIcon } from './platform-icon';
import { CaptionsList } from './captions-list';
import { ScheduleAllSheet } from './schedule-all-sheet';
import { PublishToSiteToggle } from './publish-to-site-toggle';
import { PLATFORMS, type Platform } from '@/lib/platforms';

export type PostState = {
  status: 'pending' | 'scheduled' | 'published' | 'failed' | string;
  scheduled_at: string | null;
  published_at?: string | null;
};

interface Props {
  parshaSlug: string;
  parshaName: string;
  jobId: string;
  videoId: string;
  videoUrl: string | null;
  thumbUrl: string | null;
  videoCostUsd: number | null;
  chosenScriptOption: string | null;
  publishedToSite: boolean;
  captions: Partial<Record<Platform, string>>;
  postsByPlatform: Partial<Record<Platform, PostState | null>>;
  bufferConfigured: boolean;
  /** Carousel JSX rendered when the user clicks "Pick a different script". */
  carousel: React.ReactNode;
}

const PLATFORM_DISPLAY: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  twitter: 'X',
};

function statusLabel(post: PostState | null | undefined): { label: string; live: boolean; pending: boolean } {
  if (!post) return { label: 'Not scheduled', live: false, pending: false };
  if (post.status === 'published') return { label: 'Published', live: true, pending: false };
  if (post.status === 'scheduled' && post.scheduled_at) {
    const d = new Date(post.scheduled_at);
    return {
      label: `Scheduled ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      live: false,
      pending: true,
    };
  }
  if (post.status === 'failed') return { label: 'Failed', live: false, pending: false };
  return { label: 'Pending', live: false, pending: true };
}

export function TodayPostingPanel(props: Props) {
  const {
    parshaSlug, parshaName, jobId, videoId, videoUrl, thumbUrl, videoCostUsd,
    chosenScriptOption, publishedToSite, captions, postsByPlatform,
    bufferConfigured, carousel,
  } = props;

  // When user clicks "Pick a different script", we hand the floor back to
  // the carousel — they can edit, switch, or regenerate from there.
  const [regenerating, setRegenerating] = useState(false);

  if (regenerating) {
    return (
      <>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '10px 14px',
            marginBottom: '20px',
            border: '1px dashed var(--cedar-300)',
            borderRadius: 'var(--r-md)',
            background: 'rgba(168,114,47,.04)',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13px',
            color: 'var(--cedar-700)',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
            flexWrap: 'wrap',
          }}
        >
          <span>
            Regenerating — your current video for {parshaName} stays live until a new one finishes.
          </span>
          <button
            type="button"
            onClick={() => setRegenerating(false)}
            style={{
              fontFamily: 'var(--ff-body)',
              fontStyle: 'normal',
              fontSize: '12.5px',
              color: 'var(--cedar-700)',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            ← Back to current video
          </button>
        </div>
        {carousel}
      </>
    );
  }

  // Roll up post statuses into a single headline so Yonah sees the gist
  // before scrolling. Anything pending counts as "scheduled" for purposes
  // of the headline.
  const platformStates = PLATFORMS.map((p) => ({ platform: p, state: statusLabel(postsByPlatform[p]) }));
  const anyScheduled = platformStates.some((s) => s.state.pending);
  const anyPublished = platformStates.some((s) => s.state.live);
  const headline = anyPublished && anyScheduled
    ? 'Some channels published, others scheduled'
    : anyPublished
      ? 'Published'
      : anyScheduled
        ? 'Scheduled'
        : 'Ready to post';

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto' }}>
      {/* Top: video preview + headline.
          Videos are 9:16 portrait (Seedance generates short-form vertical),
          so we cap the preview to ~200px wide and let the headline take
          the rest of the row. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '200px minmax(0, 1fr)',
          gap: '24px',
          alignItems: 'center',
          marginBottom: '28px',
        }}
        className="today-posting-top"
      >
        <Link
          href={`/videos/${parshaSlug}`}
          style={{
            position: 'relative',
            display: 'block',
            width: '200px',
            aspectRatio: '9 / 16',
            borderRadius: 'var(--r-md)',
            overflow: 'hidden',
            background: 'var(--ink-100)',
            border: '1px solid var(--ink-100)',
          }}
          aria-label={`Open ${parshaName} video detail`}
        >
          {videoUrl ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={videoUrl}
              poster={thumbUrl ?? undefined}
              muted
              playsInline
              preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onMouseEnter={(e) => { void (e.currentTarget as HTMLVideoElement).play().catch(() => {}); }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
            />
          ) : thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : null}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: 10,
              bottom: 10,
              padding: '4px 10px',
              fontFamily: 'var(--ff-body)',
              fontSize: '11px',
              letterSpacing: '0.04em',
              color: 'var(--linen-50)',
              background: 'rgba(35,27,16,.55)',
              borderRadius: '999px',
              backdropFilter: 'blur(6px)',
            }}
          >
            Open detail →
          </div>
        </Link>

        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontFamily: 'var(--ff-body)',
                fontWeight: 500,
                fontSize: '11.5px',
                padding: '4px 12px 4px 8px',
                borderRadius: '999px',
                background: 'rgba(46,125,94,.12)',
                color: 'var(--jade)',
              }}
            >
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--jade)', flexShrink: 0 }} />
              Video ready
            </span>
            {anyPublished ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontFamily: 'var(--ff-body)',
                  fontWeight: 500,
                  fontSize: '11.5px',
                  padding: '4px 12px 4px 8px',
                  borderRadius: '999px',
                  background: 'rgba(46,125,94,.12)',
                  color: 'var(--jade)',
                }}
              >
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--jade)', flexShrink: 0 }} />
                Posted
              </span>
            ) : anyScheduled ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontFamily: 'var(--ff-body)',
                  fontWeight: 500,
                  fontSize: '11.5px',
                  padding: '4px 12px 4px 8px',
                  borderRadius: '999px',
                  background: 'var(--navy-wash)',
                  color: 'var(--navy-700)',
                }}
              >
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--navy-700)', flexShrink: 0 }} />
                Scheduled
              </span>
            ) : (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontFamily: 'var(--ff-body)',
                  fontWeight: 500,
                  fontSize: '11.5px',
                  padding: '4px 12px 4px 8px',
                  borderRadius: '999px',
                  background: 'rgba(140,125,100,.08)',
                  color: 'var(--ink-500)',
                }}
              >
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--ink-300)', flexShrink: 0 }} />
                Not posted
              </span>
            )}
            <PublishToSiteToggle
              videoId={videoId}
              initialPublished={publishedToSite}
              parshaSlug={parshaSlug}
              variant="pill"
            />
          </div>
          <h2
            style={{
              fontFamily: 'var(--ff-display)',
              fontWeight: 400,
              fontSize: 'clamp(22px, 3vw, 28px)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              margin: '0 0 10px 0',
              color: 'var(--ink-900)',
              fontVariationSettings: '"opsz" 36, "SOFT" 30',
            }}
          >
            {headline}<em style={{ fontStyle: 'italic', color: 'var(--ink-500)' }}>.</em>
          </h2>
          {chosenScriptOption && (
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '13px',
                color: 'var(--ink-500)',
                fontVariationSettings: '"opsz" 14, "SOFT" 50',
              }}
            >
              From script <strong style={{ fontStyle: 'normal', color: 'var(--ink-700)' }}>{chosenScriptOption}</strong>
              {videoCostUsd !== null && (
                <> · ${videoCostUsd.toFixed(2)} to produce</>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Distribution per platform */}
      <div
        style={{
          padding: '18px 22px',
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-50)',
          marginBottom: '20px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '14px',
            color: 'var(--ink-900)',
            marginBottom: '12px',
            fontVariationSettings: '"opsz" 18, "SOFT" 30',
          }}
        >
          Distribution
        </div>
        {platformStates.map(({ platform, state }) => (
          <div
            key={platform}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '8px 0',
              borderBottom: '1px dotted var(--ink-100)',
              fontSize: '13.5px',
            }}
          >
            <span style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-500)', flexShrink: 0 }}>
              <PlatformIcon name={platform} size={16} />
            </span>
            <span style={{ fontWeight: 500, color: 'var(--ink-900)', flexShrink: 0 }}>
              {PLATFORM_DISPLAY[platform]}
            </span>
            <span
              style={{
                marginLeft: 'auto',
                color: state.live ? 'var(--jade)' : state.pending ? 'var(--cedar-700)' : 'var(--ink-500)',
                fontSize: '12.5px',
              }}
            >
              {state.label}
            </span>
          </div>
        ))}
      </div>

      {/* Action row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          alignItems: 'center',
          marginBottom: '24px',
        }}
      >
        <ScheduleAllSheet
          videoId={videoId}
          captions={captions}
          bufferConfigured={bufferConfigured}
          mode="now"
        />
        <ScheduleAllSheet
          videoId={videoId}
          captions={captions}
          bufferConfigured={bufferConfigured}
          mode="schedule"
          variant="secondary"
        />
        <button
          type="button"
          onClick={() => setRegenerating(true)}
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--ink-500)',
            background: 'none',
            border: 'none',
            padding: '11px 8px',
            minHeight: '44px',
            cursor: 'pointer',
            textDecoration: 'underline',
            textDecorationColor: 'var(--ink-200)',
            textUnderlineOffset: 4,
            marginLeft: 'auto',
          }}
        >
          Regenerate · pick a different script
        </button>
      </div>

      {/* Captions preview / edit */}
      <div
        style={{
          padding: '18px 22px',
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-50)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '14px',
            color: 'var(--ink-900)',
            marginBottom: '4px',
            fontVariationSettings: '"opsz" 18, "SOFT" 30',
          }}
        >
          Captions
        </div>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '12.5px',
            color: 'var(--ink-400)',
            margin: '0 0 14px 0',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          Click Edit on any row to refine before posting.
        </p>
        <CaptionsList jobId={jobId} captions={captions} parshaSlug={parshaSlug} />
      </div>
    </div>
  );
}
