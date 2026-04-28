'use client';

import { useEffect, useRef, useState } from 'react';
import { ScheduleAllSheet } from '@/components/schedule-all-sheet';
import { TaiChiMovePicker, type TaiChiMove } from '@/components/tai-chi-move-picker';
import type { Platform } from '@/lib/platforms';

interface Props {
  bufferConfigured: boolean;
}

type State =
  | { kind: 'idle' }
  | { kind: 'generating'; jobId: string; statusMessage: string }
  | { kind: 'done'; videoId: string; videoUrl: string; thumbUrl: string | null; captions: Partial<Record<Platform, string>> }
  | { kind: 'failed'; error: string };

/**
 * "Generate video from topic" panel for the Compose page.
 *
 * Mirrors the AI image panel's fire-and-poll pattern: POST to the
 * generate-video endpoint to create a job + fire Modal, then GET the
 * same endpoint every 5s until state flips to success or failed.
 * On success, render a 9:16 inline video with Post now / Schedule /
 * regenerate — Post/Schedule reuse the exact schedule-all sheet that
 * videos detail pages use, so captions land everywhere via the same
 * Buffer + YouTube flow.
 */
export function AiVideoPanel({ bufferConfigured }: Props) {
  const [topic, setTopic] = useState('');
  const [directorNotes, setDirectorNotes] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [moveSlug, setMoveSlug] = useState<string | null>(null);
  const [moveCache, setMoveCache] = useState<Record<string, TaiChiMove>>({});
  const currentMove = moveSlug ? moveCache[moveSlug] : null;

  useEffect(() => {
    // Pre-fetch the library so the card can display the picked move's name.
    fetch('/api/tai-chi-moves', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, TaiChiMove> = {};
        for (const m of (data.moves ?? []) as TaiChiMove[]) map[m.slug] = m;
        setMoveCache(map);
      })
      .catch(() => {});
  }, []);

  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    [],
  );

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const pollOnce = async (jobId: string) => {
    try {
      const res = await fetch(
        `/api/compose/generate-video?jobId=${encodeURIComponent(jobId)}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Poll failed (${res.status})`);
      if (data.state === 'success') {
        stopPolling();
        setState({
          kind: 'done',
          videoId: data.videoId,
          videoUrl: data.videoUrl,
          thumbUrl: data.thumbUrl ?? null,
          captions: data.captions ?? {},
        });
      } else if (data.state === 'failed') {
        stopPolling();
        setState({ kind: 'failed', error: data.error ?? 'Generation failed' });
      } else {
        setState((prev) =>
          prev.kind === 'generating'
            ? { ...prev, statusMessage: data.statusMessage ?? prev.statusMessage }
            : prev,
        );
      }
    } catch (err) {
      stopPolling();
      setState({ kind: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  };

  const startGeneration = async () => {
    if (!topic.trim() || state.kind === 'generating') return;
    stopPolling();
    setState({ kind: 'generating', jobId: '', statusMessage: 'queuing' });
    try {
      const res = await fetch('/api/compose/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, moveSlug, directorNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Start failed (${res.status})`);
      setState({ kind: 'generating', jobId: data.jobId, statusMessage: 'queued' });
      // Poll every 5s — video pipelines take 10-30 minutes.
      pollTimer.current = setInterval(() => pollOnce(data.jobId), 5000);
      // Also kick one immediate poll so the status updates quickly once
      // Modal picks up the job.
      pollOnce(data.jobId);
    } catch (err) {
      setState({ kind: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  };

  const regenerate = () => {
    stopPolling();
    setState({ kind: 'idle' });
    setTopic('');
    setMoveSlug(null);
    setDirectorNotes('');
  };

  const humanStatus = (raw: string): string => {
    const map: Record<string, string> = {
      queued: 'Queued — Modal is picking up your job',
      loading_parsha: 'Loading inputs',
      generating_plan: 'Rav Eli is writing your script',
      uploading_refs: 'Uploading character references',
      generating_clips: 'Rendering clips',
      stitching: 'Stitching the final video',
      queuing: 'Queuing…',
      finalizing: 'Finalizing',
    };
    if (map[raw]) return map[raw];
    // Custom status_message from Modal (e.g. "Generating 3 of 5 clips")
    return raw;
  };

  return (
    <div
      style={{
        padding: '22px 24px',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--linen-50)',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
      }}
    >
      <div>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '17px',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 18, "SOFT" 30',
          }}
        >
          Generate video from topic
        </div>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '12.5px',
            color: 'var(--ink-500)',
            marginTop: '2px',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          Rav Eli writes a ~45s teaching from your topic, then the full video pipeline renders it. ~10–30 min.
        </div>
      </div>

      {state.kind === 'idle' && (
        <>
          <div>
            <label htmlFor="ai-video-topic" style={LABEL_STYLE}>
              Topic
            </label>
            <textarea
              id="ai-video-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              placeholder="e.g. the discipline of slowing down before you speak; kabbalistic tzimtzum and yielding; why we bow before lifting"
              style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: '80px', lineHeight: 1.5 }}
            />
            <div style={HELP_STYLE}>{topic.length} characters</div>
          </div>

          <div>
            <label htmlFor="ai-video-director-notes" style={LABEL_STYLE}>
              Director notes (optional)
            </label>
            <textarea
              id="ai-video-director-notes"
              value={directorNotes}
              onChange={(e) => setDirectorNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder='e.g. "set the outdoor clips by a slow river" or "make sure he meditates in the dojo clip"'
              style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: '70px', lineHeight: 1.5 }}
            />
            <div style={HELP_STYLE}>{directorNotes.length}/1000</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '12px 0' }}>
            {moveSlug ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '13px', color: 'var(--ink-700)' }}>
                Move: <strong style={{ fontStyle: 'normal', fontWeight: 500 }}>{currentMove?.english ?? moveSlug}</strong>
                <button type="button" onClick={() => setPickerOpen(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink-500)', fontSize: '12.5px', textDecoration: 'underline', cursor: 'pointer' }}>change</button>
                <span style={{ color: 'var(--ink-300)' }}>·</span>
                <button type="button" onClick={() => setMoveSlug(null)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink-500)', fontSize: '12.5px', textDecoration: 'underline', cursor: 'pointer' }}>remove</button>
              </span>
            ) : (
              <button type="button" onClick={() => setPickerOpen(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink-500)', fontSize: '13px', textDecoration: 'underline', cursor: 'pointer' }}>
                Add tai chi move (optional)
              </button>
            )}
          </div>
          <TaiChiMovePicker
            open={pickerOpen}
            currentSlug={moveSlug}
            onSelect={(slug) => setMoveSlug(slug)}
            onClose={() => setPickerOpen(false)}
          />

          <div>
            <button
              type="button"
              onClick={startGeneration}
              disabled={!topic.trim()}
              style={{
                ...CTA_STYLE,
                opacity: !topic.trim() ? 0.5 : 1,
                cursor: !topic.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              ✦ Generate video
            </button>
          </div>
        </>
      )}

      {state.kind === 'generating' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            padding: '20px 22px',
            background: 'var(--navy-wash)',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--ink-100)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <Spinner />
            <div style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '15px', color: 'var(--ink-900)' }}>
              {humanStatus(state.statusMessage)}
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '12.5px',
              color: 'var(--ink-500)',
            }}
          >
            This page can stay open in the background. The full pipeline usually takes 10–30 minutes.
          </div>
          <div>
            <button type="button" onClick={regenerate} style={GHOST_STYLE}>
              Cancel &amp; start over
            </button>
          </div>
        </div>
      )}

      {state.kind === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              background: 'var(--ink-900)',
              borderRadius: 'var(--r-md)',
              overflow: 'hidden',
              maxWidth: '320px',
              aspectRatio: '9 / 16',
              alignSelf: 'flex-start',
            }}
          >
            <video
              src={state.videoUrl}
              poster={state.thumbUrl ?? undefined}
              controls
              playsInline
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <ScheduleAllSheet
              videoId={state.videoId}
              captions={state.captions}
              bufferConfigured={bufferConfigured}
            />
            <button type="button" onClick={regenerate} style={GHOST_STYLE}>
              Regenerate from new topic
            </button>
          </div>

          <details style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12px', color: 'var(--ink-400)' }}>
            <summary style={{ cursor: 'pointer' }}>See generated captions</summary>
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(Object.keys(state.captions) as Platform[]).map((platform) => (
                <div key={platform} style={{ padding: '10px 12px', background: 'var(--ink-100)', borderRadius: 'var(--r-sm)' }}>
                  <div
                    style={{
                      fontFamily: 'var(--ff-body)',
                      fontSize: '10.5px',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-500)',
                      marginBottom: '4px',
                    }}
                  >
                    {platform}
                  </div>
                  <div style={{ fontFamily: 'var(--ff-body)', fontStyle: 'normal', fontSize: '13px', color: 'var(--ink-700)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {state.captions[platform]}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {state.kind === 'failed' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--r-sm)',
              background: 'rgba(192,57,43,.08)',
              border: '1px solid rgba(192,57,43,.2)',
              fontFamily: 'var(--ff-body)',
              fontSize: '12.5px',
              color: '#8b2d1c',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}
          >
            {state.error}
          </div>
          <div>
            <button type="button" onClick={regenerate} style={GHOST_STYLE}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        border: '2px solid var(--ink-100)',
        borderTopColor: 'var(--navy-800)',
        display: 'inline-block',
        animation: 'tt-spin 0.9s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--ff-body)',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-500)',
  marginBottom: '8px',
};

const INPUT_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '12px 14px',
  fontFamily: 'var(--ff-body)',
  fontSize: '14.5px',
  color: 'var(--ink-900)',
  background: 'var(--linen-50)',
  border: '1px solid var(--ink-200)',
  borderRadius: 'var(--r-md)',
  outline: 'none',
  transition: 'border-color var(--trans)',
  boxSizing: 'border-box',
};

const HELP_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-display)',
  fontStyle: 'italic',
  fontSize: '12px',
  color: 'var(--ink-400)',
  marginTop: '6px',
};

const CTA_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-body)',
  fontWeight: 500,
  fontSize: '13.5px',
  padding: '10px 20px',
  minHeight: '40px',
  borderRadius: '999px',
  border: '1px solid var(--navy-800)',
  background: 'var(--navy-800)',
  color: 'var(--linen-50)',
  cursor: 'pointer',
  transition: 'all var(--trans)',
};

const GHOST_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-body)',
  fontWeight: 500,
  fontSize: '13.5px',
  padding: '10px 20px',
  minHeight: '40px',
  borderRadius: '999px',
  border: '1px solid var(--ink-200)',
  background: 'transparent',
  color: 'var(--ink-700)',
  cursor: 'pointer',
  transition: 'all var(--trans)',
};
