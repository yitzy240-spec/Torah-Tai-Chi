// dashboard/src/app/videos/[slug]/_components/live-at-rest.tsx
//
// Renders the calm status display per spec §5.1 when a live version exists
// and no draft is in progress ("live-at-rest" state).
//
// Layout: video player on the left (~200px wide on desktop; full width on
// mobile), LIVE pill + per-channel status list on the right. Footer has
// "Download mp4" (≥44pt) and outlined "Replace with a new version" button.
// "Replace" opens a BottomSheet confirm per spec §5.4; confirm calls onReplace.

'use client';
import { useState } from 'react';
import { BottomSheet } from './bottom-sheet';

export interface PlatformStatus {
  platform: string;
  postedAt: string | null;
  postUrl: string | null;
  viewsLabel: string | null;
}

interface Props {
  parshaName: string;
  versionLabel: string;         // e.g. "v2"
  videoMp4Url: string;
  thumbPath: string | null;
  websiteUrl: string;
  title: string;
  subtitle: string;
  publishedToWebsiteSince: string | null;
  platforms: PlatformStatus[];  // includes website row + social rows
  onReplace: () => void;
}

export function LiveAtRest(p: Props) {
  const [confirmReplace, setConfirmReplace] = useState(false);

  return (
    <section style={{ width: '100%' }}>
      {/* Two-column layout: video left, info right (stacks on mobile) */}
      <div
        style={{
          display: 'flex',
          gap: 18,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
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

          {/* Title + subtitle */}
          <h2
            style={{
              margin: '0 0 4px',
              fontFamily: 'var(--ff-display)',
              fontSize: 22,
              lineHeight: 1.2,
              color: 'var(--ink-900)',
            }}
          >
            {p.subtitle || p.parshaName}
          </h2>
          <p
            style={{
              margin: '0 0 16px',
              color: 'var(--ink-500)',
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {p.title}
          </p>

          {/* Per-channel status list */}
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              border: '1px solid var(--ink-100)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {p.platforms.map((pl, i) => {
              const isPosted = pl.postedAt !== null;
              return (
                <li
                  key={pl.platform}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderBottom:
                      i < p.platforms.length - 1 ? '1px solid var(--ink-100)' : 'none',
                    fontSize: 13,
                    color: isPosted ? 'var(--ink-900)' : 'var(--ink-400)',
                    background: 'white',
                  }}
                >
                  <span>
                    {pl.platform}
                    {isPosted
                      ? ` · posted ${new Date(pl.postedAt!).toLocaleDateString()}`
                      : ' · not posted'}
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
                        marginLeft: 8,
                      }}
                    >
                      {pl.viewsLabel ?? 'View'} →
                    </a>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Footer: download + replace */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 18,
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
        </div>
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
