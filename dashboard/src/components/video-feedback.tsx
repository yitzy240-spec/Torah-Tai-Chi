'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitFeedback } from '@/app/actions/submit-feedback';

/**
 * Yonah identifies clips by what Rav Eli says, not by clip number — so the
 * UI surfaces the voiceover text and never says "Clip N". The list auto-
 * highlights the currently-playing clip via <video onTimeUpdate>, and
 * clicking a clip seeks the player to that clip's start.
 *
 * Feedback can be per-clip ("the desert gesture in this section felt off")
 * or general ("the whole pacing is rushed"). Either path triggers a fresh
 * full-pipeline regen with the feedback merged into director_notes — Cut 2
 * will add per-clip surgery.
 */
export interface FeedbackClip {
  id: string;
  voiceover: string;
  /** Cumulative start (seconds) of this clip relative to the full video. */
  startS: number;
  /** End (seconds), exclusive. Equals startS + duration_s. */
  endS: number;
}

interface Props {
  videoId: string | null;
  videoUrl: string | null;
  thumbUrl: string | null;
  captionsVttDataUrl: string | null;
  clips: FeedbackClip[];
  /** Estimated cost shown on the submit button. */
  costEstimateUsd: number | null;
  /** Coarse copy for resolution: "720p" | "1080p" etc. */
  resolutionLabel: string | null;
  /** True when this version's parent clips are all checkpointed in
   * Storage so general feedback will route to smart regen (Claude
   * picks affected clips, only those re-render). False on legacy
   * videos where general feedback still triggers a full regen. */
  smartRegenAvailable: boolean;
}

export function VideoFeedback({
  videoId,
  videoUrl,
  thumbUrl,
  captionsVttDataUrl,
  clips,
  costEstimateUsd,
  resolutionLabel,
  smartRegenAvailable,
}: Props) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [openClipId, setOpenClipId] = useState<string | null>(null);
  const [generalText, setGeneralText] = useState('');
  const [perClipText, setPerClipText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const totalDuration = clips.length > 0 ? clips[clips.length - 1].endS : 0;

  // Determine the currently-playing clip. If currentTime >= total, the last
  // clip stays highlighted (boundary case from spec).
  const currentClipId = useMemo(() => {
    if (clips.length === 0) return null;
    if (currentTime >= totalDuration) return clips[clips.length - 1].id;
    const hit = clips.find((c) => c.startS <= currentTime && currentTime < c.endS);
    return hit?.id ?? null;
  }, [clips, currentTime, totalDuration]);

  // onTimeUpdate fires ~4x/sec — fine for highlighting, no throttling needed.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    el.addEventListener('timeupdate', onTime);
    return () => el.removeEventListener('timeupdate', onTime);
  }, [videoUrl]);

  function seekTo(clip: FeedbackClip) {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = clip.startS;
    if (el.paused) {
      void el.play().catch(() => {});
    }
  }

  function submit(clipId: string | null, text: string) {
    if (!videoId) return;
    setError(null);
    startTransition(async () => {
      const res = await submitFeedback({ videoId, clipId, text });
      if ('error' in res) {
        setError(res.error);
        return;
      }
      // Clean reset before redirect so React doesn't flash stale state.
      setOpenClipId(null);
      setPerClipText('');
      setGeneralText('');
      router.push(`/jobs/${res.jobId}`);
    });
  }

  return (
    <div>
      {/* Phone-frame video player — matches the original page layout. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr',
          gap: '32px',
          marginBottom: '32px',
          alignItems: 'start',
        }}
        className="row-video-script"
      >
        <div
          style={{
            position: 'relative',
            width: '280px',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-page)',
            background: 'var(--ink-900)',
          }}
        >
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              poster={thumbUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              crossOrigin={captionsVttDataUrl ? 'anonymous' : undefined}
              style={{
                width: '100%',
                aspectRatio: '9 / 16',
                display: 'block',
                background: 'var(--ink-900)',
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
          ) : (
            <div
              style={{
                aspectRatio: '9 / 16',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--ink-800)',
                color: 'var(--linen-50)',
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '13px',
                opacity: 0.6,
                padding: '24px',
                textAlign: 'center',
              }}
            >
              No video yet.
            </div>
          )}
          {videoUrl && (
            <div style={{ display: 'flex', gap: '6px', padding: '10px 12px', background: 'var(--ink-800)' }}>
              <a
                href={videoUrl}
                download
                style={{
                  flex: 1,
                  minHeight: '38px',
                  fontFamily: 'var(--ff-body)',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--linen-100)',
                  background: 'rgba(250,244,232,.08)',
                  border: '1px solid rgba(250,244,232,.12)',
                  borderRadius: '999px',
                  letterSpacing: '0.02em',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                Download
              </a>
            </div>
          )}
        </div>

        {/* Clip list — voiceover text only, no clip numbers. */}
        <div>
          {clips.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '13px',
                  color: 'var(--ink-400)',
                  marginBottom: '4px',
                  fontVariationSettings: '"opsz" 14, "SOFT" 60',
                }}
              >
                Click any line to jump to that moment. Hover to leave a note.
              </div>
              {clips.map((clip) => {
                const isCurrent = clip.id === currentClipId;
                const isOpen = clip.id === openClipId;
                return (
                  <div
                    key={clip.id}
                    style={{
                      border: isCurrent ? '1px solid var(--cedar-500)' : '1px solid var(--ink-100)',
                      background: isCurrent ? 'rgba(240,223,193,.35)' : 'var(--linen-50)',
                      borderRadius: 'var(--r-md)',
                      padding: '14px 16px',
                      transition: 'background var(--trans), border-color var(--trans)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => seekTo(clip)}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: videoUrl ? 'pointer' : 'default',
                          fontFamily: 'var(--ff-body)',
                          fontSize: '14.5px',
                          lineHeight: 1.55,
                          color: 'var(--ink-900)',
                        }}
                        disabled={!videoUrl}
                      >
                        {clip.voiceover || <span style={{ color: 'var(--ink-400)', fontStyle: 'italic' }}>(no voiceover)</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenClipId(isOpen ? null : clip.id);
                          setPerClipText('');
                          setError(null);
                        }}
                        style={{
                          fontFamily: 'var(--ff-body)',
                          fontSize: '12px',
                          fontWeight: 500,
                          color: isOpen ? 'var(--ink-900)' : 'var(--cedar-700)',
                          background: 'transparent',
                          border: 'none',
                          padding: '4px 0',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                        disabled={!videoId}
                      >
                        {isOpen ? 'Cancel' : 'Fix this clip'}
                      </button>
                    </div>
                    {isOpen && (
                      <div style={{ marginTop: '12px' }}>
                        <textarea
                          autoFocus
                          value={perClipText}
                          onChange={(e) => setPerClipText(e.target.value)}
                          placeholder="What felt off in this section? E.g. the gesture didn't match the gravity of the line..."
                          style={{
                            width: '100%',
                            minHeight: '72px',
                            padding: '12px 14px',
                            border: '1px solid var(--ink-200)',
                            borderRadius: 'var(--r-md)',
                            background: 'var(--linen-50)',
                            fontFamily: 'var(--ff-body)',
                            fontSize: '14px',
                            color: 'var(--ink-900)',
                            resize: 'vertical',
                            lineHeight: 1.5,
                            outline: 'none',
                          }}
                        />
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: '10px',
                            marginTop: '10px',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => submit(clip.id, perClipText)}
                            disabled={isPending || perClipText.trim().length === 0}
                            style={{
                              fontFamily: 'var(--ff-body)',
                              fontWeight: 500,
                              fontSize: '13px',
                              padding: '9px 18px',
                              minHeight: '40px',
                              borderRadius: '999px',
                              border: '1px solid var(--navy-800)',
                              background: 'var(--navy-800)',
                              color: 'var(--linen-50)',
                              cursor: isPending || perClipText.trim().length === 0 ? 'not-allowed' : 'pointer',
                              opacity: isPending || perClipText.trim().length === 0 ? 0.5 : 1,
                            }}
                          >
                            {isPending ? 'Submitting…' : `Re-render full video${costPreview(costEstimateUsd, resolutionLabel)}`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '13.5px',
                color: 'var(--ink-400)',
                fontVariationSettings: '"opsz" 14, "SOFT" 60',
              }}
            >
              {videoUrl ? 'Clip-level voiceover unavailable for this video.' : 'No video yet.'}
            </div>
          )}
        </div>
      </div>

      {/* General feedback box — full width, mirrors the original visual. */}
      <div
        style={{
          padding: '28px 32px',
          border: '1px solid var(--cedar-300)',
          borderRadius: 'var(--r-lg)',
          background: 'linear-gradient(180deg, rgba(240,223,193,.3) 0%, var(--linen-50) 100%)',
          marginBottom: '28px',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '18px',
            margin: '0 0 6px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 22, "SOFT" 30',
          }}
        >
          What would you change?
        </h3>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13.5px',
            color: 'var(--ink-500)',
            margin: '0 0 16px 0',
            fontVariationSettings: '"opsz" 14, "SOFT" 60',
          }}
        >
          Describe what felt off across the whole video. We&apos;ll re-render with your feedback as direction.
        </p>
        <textarea
          value={generalText}
          onChange={(e) => setGeneralText(e.target.value)}
          placeholder="The pacing felt rushed throughout, and Rav Eli's gestures didn't match the gravity of the lines..."
          style={{
            width: '100%',
            minHeight: '88px',
            padding: '16px 18px',
            border: '1px solid var(--ink-200)',
            borderRadius: 'var(--r-md)',
            background: 'var(--linen-50)',
            fontFamily: 'var(--ff-body)',
            fontSize: '15px',
            color: 'var(--ink-900)',
            resize: 'vertical',
            lineHeight: 1.55,
            outline: 'none',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            marginTop: '14px',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '13px',
              color: 'var(--ink-400)',
              lineHeight: 1.45,
              fontVariationSettings: '"opsz" 14, "SOFT" 60',
              flex: 1,
              minWidth: '240px',
            }}
          >
            {smartRegenAvailable
              ? 'Smart regen rewrites only the clips your feedback touches — usually 1–3. You\u2019ll get an email when it\u2019s ready.'
              : 'Re-render takes ~10\u201315 minutes. You\u2019ll get an email when the new version is ready.'}
          </div>
          <button
            type="button"
            onClick={() => submit(null, generalText)}
            disabled={isPending || generalText.trim().length === 0 || !videoId}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: '14px',
              padding: '11px 22px',
              minHeight: '44px',
              borderRadius: '999px',
              border: '1px solid var(--navy-800)',
              background: 'var(--navy-800)',
              color: 'var(--linen-50)',
              cursor: isPending || generalText.trim().length === 0 || !videoId ? 'not-allowed' : 'pointer',
              opacity: isPending || generalText.trim().length === 0 || !videoId ? 0.5 : 1,
              transition: 'all var(--trans)',
            }}
          >
            {isPending
              ? 'Submitting…'
              : smartRegenAvailable
                ? 'Smart regen \u00b7 only affected clips \u00b7 usually ~$1\u20133 \u00b7 ~3\u20138 min'
                : `Re-render full video${costPreview(costEstimateUsd, resolutionLabel)}`}
          </button>
        </div>
        {error && (
          <div
            style={{
              marginTop: '12px',
              fontFamily: 'var(--ff-body)',
              fontSize: '13px',
              color: 'var(--tassel)',
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cost preview suffix for the submit button. Falls back to a coarse range
 * when seedance-pricing didn't produce a number (e.g. the parent job's
 * resolution / tier combo isn't priced).
 */
function costPreview(estimate: number | null, resolution: string | null): string {
  if (estimate !== null) {
    return ` · ~$${estimate.toFixed(2)} · ~10–15 min`;
  }
  if (resolution === '1080p') return ' · ~$8 · ~10–15 min';
  if (resolution === '720p') return ' · ~$5 · ~10–15 min';
  return ' · ~10–15 min';
}
