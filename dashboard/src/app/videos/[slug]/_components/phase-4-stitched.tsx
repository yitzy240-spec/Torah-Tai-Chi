// dashboard/src/app/videos/[slug]/_components/phase-4-stitched.tsx
//
// Phase 4: Stitched video. Full-bleed 9:16 video player with captions
// track (VTT data URL built from clip plan via buildClipPayload) and
// scrub markers at each clip boundary.
//
// Per spec §4 Phase 4. Mockup: 12-post-regen-view.html option A.

'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { publicVideoUrl } from '@/lib/storage-url';
import { useJobStream } from '@/hooks/use-job-stream';
import { isTerminalStage } from '@/lib/job-event-types';
import { humanizeRenderError } from '@/lib/humanize-render-error';
import { TransitionsControl } from './transitions-control';
import type { CutType } from '../_data/phase-4-data';

interface Props {
  videoId: string;
  videoMp4Path: string | null;
  thumbPath: string | null;
  composeJobId: string | null;
  captionsVttDataUrl: string | null;
  /** Cumulative start-of-clip offsets in seconds, e.g. [0, 9, 19, 28] */
  clipBoundariesS: number[];
  totalDurationS: number;
  autoCutTypes: CutType[];
  cutOverrides: Record<string, CutType>;
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
  autoCutTypes,
  cutOverrides,
  onAdvance,
  onBack,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const router = useRouter();
  const liveEvent = useJobStream(composeJobId);

  // Re-stitch (transitions) runs the SAME compose job in place. The mp4
  // storage path is deterministic, so the URL never changes — bump a
  // client cache-buster on each re-stitch completion to force the <video>
  // to re-fetch the overwritten file.
  const [restitching, setRestitching] = useState(false);
  const [cacheBust, setCacheBust] = useState(0);

  const effectiveMp4 = liveEvent?.videoPath ?? videoMp4Path;
  const effectiveThumb = thumbPath; // thumb refreshes via router.refresh on done — see useEffect below

  const composeFailed = liveEvent?.stage === 'failed';
  const composeCancelled = liveEvent?.stage === 'cancelled';
  const composeError = liveEvent?.message ?? null;

  // When the pipeline reaches a terminal stage, ask the server for a fresh
  // render so we pick up thumb_path (and any other fields not on the event)
  // that Modal wrote to the videos row alongside the mp4. If a re-stitch was
  // in flight, clear it and bust the cache so the new cut timings show.
  useEffect(() => {
    if (liveEvent && isTerminalStage(liveEvent.stage)) {
      if (restitching) {
        setRestitching(false);
        setCacheBust((n) => n + 1);
      }
      router.refresh();
    }
  }, [liveEvent, router, restitching]);

  // Backstop: never let the re-stitch spinner hang forever if the realtime
  // stream misses the terminal event (see MEMORY feedback_realtime_listeners
  // _need_both_terminal_states). Give it 3 min, then refresh + recover.
  useEffect(() => {
    if (!restitching) return;
    const t = setTimeout(() => {
      setRestitching(false);
      setCacheBust((n) => n + 1);
      router.refresh();
    }, 180_000);
    return () => clearTimeout(t);
  }, [restitching, router]);

  if (composeFailed && !effectiveMp4) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', minHeight: 240, background: 'var(--linen-50)', border: '1px solid var(--tassel)', borderRadius: 'var(--r-lg)', textAlign: 'center' }}>
        <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--tassel)', color: 'white', fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>!</div>
        <div style={{ fontFamily: 'var(--ff-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink-900)', marginBottom: 8 }}>Stitching failed</div>
        <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 360, lineHeight: 1.5, marginBottom: 16 }}>
          {humanizeRenderError(composeError)}
        </div>
        <button type="button" onClick={onBack} style={{ minHeight: 44, padding: '10px 18px', fontSize: 14, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}>
          ← Back to clips
        </button>
      </div>
    );
  }

  // Without this branch, cancelling a compose mid-flight stuck the
  // operator on the stitching spinner forever. Same bug class as
  // MEMORY feedback_realtime_listeners_need_both_terminal_states.
  if (composeCancelled && !effectiveMp4) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', minHeight: 240, background: 'var(--linen-50)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-lg)', textAlign: 'center' }}>
        <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--ink-300)', color: 'white', fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>×</div>
        <div style={{ fontFamily: 'var(--ff-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink-900)', marginBottom: 8 }}>Cancelled</div>
        <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 360, lineHeight: 1.5, marginBottom: 16 }}>
          You cancelled the stitch. Go back to clips and try again when you&apos;re ready.
        </div>
        <button type="button" onClick={onBack} style={{ minHeight: 44, padding: '10px 18px', fontSize: 14, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}>
          ← Back to clips
        </button>
      </div>
    );
  }

  if (restitching) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', minHeight: 240, background: 'var(--linen-50)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-lg)', textAlign: 'center' }}>
        <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--ink-100)', borderTopColor: 'var(--navy-700)', animation: 'spin 0.9s linear infinite', marginBottom: 18 }} />
        <div style={{ fontFamily: 'var(--ff-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink-900)', marginBottom: 8 }}>Re-stitching your video…</div>
        <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 360, lineHeight: 1.5 }}>
          Re-joining your clips with the new transitions. No clips are being re-generated — usually under a minute. This updates automatically.
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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

  // Cache-buster only after a re-stitch (cacheBust>0) so the first render
  // keeps a clean URL. Same path is overwritten in place by the re-stitch.
  const bust = cacheBust > 0 ? `?v=${cacheBust}` : '';
  const videoUrl = publicVideoUrl(effectiveMp4) + bust;
  const posterUrl = effectiveThumb ? publicVideoUrl(effectiveThumb) + bust : undefined;

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
      {/* 9:16 vertical player wrapped so it stays phone-shaped on
          desktop. Without maxWidth, width:100% + aspect-ratio 9/16
          rendered a viewport-spanning vertical column the operator
          couldn't see in one glance (Yonah 2026-05-29 screenshot:
          only player + Continue button visible, nothing else above the
          fold). The wrapper container keeps the scrub markers + clip
          labels aligned under the centered player on desktop and the
          full width on mobile (where maxWidth doesn't bind). */}
      <div style={{ maxWidth: 360, margin: '0 auto' }}>
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
      </div>

      {/* Transitions control — Auto by default; adjust + re-stitch (no
          re-generation). Kept phone-width to align with the player. */}
      <div style={{ maxWidth: 360, margin: '0 auto' }}>
        <TransitionsControl
          videoId={videoId}
          autoCutTypes={autoCutTypes}
          cutOverrides={cutOverrides}
          clipBoundariesS={clipBoundariesS}
          onRestitchStart={() => setRestitching(true)}
        />
      </div>

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
