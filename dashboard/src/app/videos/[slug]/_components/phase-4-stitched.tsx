// dashboard/src/app/videos/[slug]/_components/phase-4-stitched.tsx
//
// Phase 4: Stitched video. Full-bleed 9:16 video player with captions
// track (VTT data URL built from clip plan via buildClipPayload) and
// scrub markers at each clip boundary.
//
// Per spec §4 Phase 4. Mockup: 12-post-regen-view.html option A.

'use client';
import { useRef } from 'react';
import { publicVideoUrl } from '@/lib/storage-url';

interface Props {
  videoMp4Path: string | null;
  thumbPath: string | null;
  captionsVttDataUrl: string | null;
  /** Cumulative start-of-clip offsets in seconds, e.g. [0, 9, 19, 28] */
  clipBoundariesS: number[];
  totalDurationS: number;
  onAdvance: () => void;
  onBack: () => void;
}

export function Phase4Stitched({
  videoMp4Path,
  thumbPath,
  captionsVttDataUrl,
  clipBoundariesS,
  totalDurationS,
  onAdvance,
  onBack,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  if (!videoMp4Path) {
    return (
      <p style={{ color: 'var(--ink-500)', textAlign: 'center', padding: '24px 0' }}>
        Stitched video not ready yet — check back in a moment.
      </p>
    );
  }

  const videoUrl = publicVideoUrl(videoMp4Path);
  const posterUrl = thumbPath ? publicVideoUrl(thumbPath) : undefined;

  function jumpToClip(startS: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = startS;
    v.play().catch(() => {
      // iOS may require user gesture; ignore the rejection
    });
  }

  return (
    <section>
      {/* Full-bleed 9:16 player */}
      <video
        ref={videoRef}
        src={videoUrl}
        poster={posterUrl}
        controls
        playsInline
        crossOrigin={captionsVttDataUrl ? 'anonymous' : undefined}
        style={{
          width: '100%',
          aspectRatio: '9 / 16',
          borderRadius: 8,
          background: 'var(--ink-900)',
          display: 'block',
        }}
      >
        {captionsVttDataUrl && (
          <track
            kind="captions"
            srcLang="en"
            label="English"
            default
            src={captionsVttDataUrl}
          />
        )}
      </video>

      {/* Scrub markers below the player — tap to jump (spec §4 Phase 4) */}
      {totalDurationS > 0 && clipBoundariesS.length > 1 && (
        <div
          style={{
            position: 'relative',
            height: 24,
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/* Track background */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 4,
              background: 'var(--ink-100)',
              borderRadius: 2,
            }}
          />
          {/* Clip boundary markers */}
          {clipBoundariesS.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => jumpToClip(s)}
              title={`Clip ${i + 1}`}
              style={{
                position: 'absolute',
                left: `${(s / totalDurationS) * 100}%`,
                transform: 'translateX(-50%)',
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: i === 0 ? 'var(--navy-800)' : 'var(--navy-700)',
                border: '2px solid white',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label={`Jump to clip ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Clip labels row */}
      {clipBoundariesS.length > 0 && (
        <div
          style={{
            display: 'flex',
            marginTop: 4,
          }}
        >
          {clipBoundariesS.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => jumpToClip(s)}
              style={{
                flex: i === clipBoundariesS.length - 1
                  ? `${((totalDurationS - s) / totalDurationS) * 100}%`
                  : `${((clipBoundariesS[i + 1] - s) / totalDurationS) * 100}%`,
                background: 'none',
                border: 'none',
                fontSize: 10,
                color: 'var(--ink-500)',
                cursor: 'pointer',
                textAlign: 'left',
                padding: '2px 0',
                minHeight: 24,
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Sticky bottom action bar */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'white',
          borderTop: '1px solid var(--ink-100)',
          padding: '10px 0 max(16px, env(safe-area-inset-bottom))',
          marginTop: 18,
        }}
      >
        <button
          type="button"
          onClick={onAdvance}
          style={{
            width: '100%',
            minHeight: 48,
            fontSize: 15,
            fontWeight: 500,
            background: 'var(--navy-700)',
            color: 'var(--linen-50)',
            border: 'none',
            borderRadius: 10,
            padding: 14,
            cursor: 'pointer',
          }}
        >
          Continue to posting →
        </button>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ink-500)',
              textDecoration: 'underline',
              fontSize: 13,
              cursor: 'pointer',
              minHeight: 44,
              padding: '0 8px',
            }}
          >
            ← Back to clips
          </button>
        </div>
      </div>
    </section>
  );
}
