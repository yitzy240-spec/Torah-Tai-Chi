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
import { useRealtimeRow } from '@/hooks/use-realtime-row';

interface Props {
  videoId: string;
  videoMp4Path: string | null;
  thumbPath: string | null;
  composeJobId: string | null;
  captionsVttDataUrl: string | null;
  /** Cumulative start-of-clip offsets in seconds, e.g. [0, 9, 19, 28] */
  clipBoundariesS: number[];
  totalDurationS: number;
  onAdvance: () => void;
  onBack: () => void;
}

export function Phase4Stitched({
  videoId,
  videoMp4Path,
  thumbPath,
  composeJobId,
  captionsVttDataUrl,
  clipBoundariesS,
  totalDurationS,
  onAdvance,
  onBack,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const liveVideo = useRealtimeRow<{ id: string; mp4_path: string | null; thumb_path: string | null }>(
    'videos',
    videoId,
    { id: videoId, mp4_path: videoMp4Path, thumb_path: thumbPath },
  );
  const effectiveMp4 = liveVideo?.mp4_path ?? videoMp4Path;
  const effectiveThumb = liveVideo?.thumb_path ?? thumbPath;

  const liveJob = useRealtimeRow<{ id: string; status: string; error_message: string | null }>(
    'jobs',
    composeJobId,
    null,
  );
  const composeFailed = liveJob?.status === 'failed';
  const composeError = liveJob?.error_message ?? null;

  if (composeFailed && !effectiveMp4) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', minHeight: 240, background: 'var(--linen-50)', border: '1px solid var(--tassel)', borderRadius: 'var(--r-lg)', textAlign: 'center' }}>
        <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--tassel)', color: 'white', fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>!</div>
        <div style={{ fontFamily: 'var(--ff-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink-900)', marginBottom: 8 }}>Stitching failed</div>
        <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 360, lineHeight: 1.5, marginBottom: 16 }}>
          {composeError ? composeError.split('\n')[0].slice(0, 220) : 'Modal returned no error message.'}
        </div>
        <button type="button" onClick={onBack} style={{ minHeight: 44, padding: '10px 18px', fontSize: 14, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}>
          ← Back to clips
        </button>
      </div>
    );
  }

  if (!effectiveMp4) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', minHeight: 240, background: 'var(--linen-50)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-lg)', textAlign: 'center' }}>
        <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--ink-100)', borderTopColor: 'var(--navy-700)', animation: 'spin 0.9s linear infinite', marginBottom: 18 }} />
        <div style={{ fontFamily: 'var(--ff-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink-900)', marginBottom: 8 }}>Stitching your video…</div>
        <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 360, lineHeight: 1.5 }}>
          Modal is assembling all the clips into the final mp4. Usually 1–3 minutes. This page updates automatically when it&apos;s ready.
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const videoUrl = publicVideoUrl(effectiveMp4);
  const posterUrl = effectiveThumb ? publicVideoUrl(effectiveThumb) : undefined;

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
