'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateClipText } from '@/app/actions/update-clip-text';
import { regenClipFromText } from '@/app/actions/regen-clip-from-text';
import { estimateSeedanceCost, TIER_OPTIONS, type Resolution, type ModelTier } from '@/lib/seedance-pricing';

/** Label format like "720p Fast" / "1080p Standard". Used both for the
 *  per-version header pill and for the tier-picker dropdown options. */
function tierLabel(resolution: Resolution | null, tier: ModelTier | null): string | null {
  if (!resolution && !tier) return null;
  const parts: string[] = [];
  if (resolution) parts.push(resolution);
  if (tier) parts.push(tier === 'fast' ? 'Fast' : 'Standard');
  return parts.join(' ');
}
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';

const TERMINAL_JOB_STATUSES = new Set(['done', 'failed']);

/**
 * Wait until a job hits a terminal status. Subscribes to Supabase
 * Realtime on the jobs row for instant detection, plus a slower
 * polling fallback in case Realtime drops a message. Times out at
 * `timeoutMs` (returns 'timeout' status). Same pattern as
 * regen-in-progress-banner.tsx.
 */
function waitForJobTerminal(
  jobId: string,
  timeoutMs: number,
): Promise<{ status: string; errorMessage: string | null }> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = async (status: string) => {
      if (resolved) return;
      resolved = true;
      try { void supabase.removeChannel(channel); } catch { /* noop */ }
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      // On failure, do one final fetch to grab error_message so the
      // caller can render an actionable error (e.g. credits exhausted)
      // instead of a generic "Re-render failed" string.
      let errorMessage: string | null = null;
      if (status === 'failed') {
        try {
          const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
          if (res.ok) {
            const data = (await res.json()) as { errorMessage?: string | null };
            errorMessage = data.errorMessage ?? null;
          }
        } catch {
          // Best-effort — leave errorMessage null and the caller will
          // fall back to the generic message.
        }
      }
      resolve({ status, errorMessage });
    };

    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`regen-clip-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const status = (payload.new as { status?: string } | null)?.status;
          if (status && TERMINAL_JOB_STATUSES.has(status)) void finish(status);
        },
      )
      .subscribe();

    // Polling fallback every 8s — slower than the prior 5s loop because
    // Realtime is the primary path here. Catches the case where Realtime
    // drops a message or is briefly disconnected.
    const pollTimer = setInterval(async () => {
      if (resolved) return;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status && TERMINAL_JOB_STATUSES.has(data.status)) void finish(data.status);
      } catch {
        // transient — keep waiting
      }
    }, 8000);

    const timeoutTimer = setTimeout(() => void finish('timeout'), timeoutMs);
  });
}

/**
 * Translate a raw error_message from a failed regen into a friendly
 * message Yonah can act on. Most importantly: when Kie returns
 * "credits exhausted" (or similar phrasing), surface a clear "out of
 * credits" line with a top-up CTA instead of the generic fallback.
 */
function friendlyRenderError(raw: string | null): string {
  if (!raw) return 'Re-render failed. Open the parsha page logs for details.';
  const lower = raw.toLowerCase();
  if (
    lower.includes('credit') &&
    (lower.includes('exhaust') || lower.includes('insufficient') || lower.includes('not enough'))
  ) {
    return 'Out of Kie credits. Top up at kie.ai/billing, then try again.';
  }
  if (lower.includes('quota')) {
    return 'Kie quota hit. Wait a few minutes or top up at kie.ai/billing, then try again.';
  }
  // Otherwise show the first line of the actual error so we can debug
  // remotely from a screenshot. Truncate aggressively.
  const firstLine = raw.split('\n')[0]?.trim() ?? raw;
  return `Re-render failed: ${firstLine.slice(0, 220)}`;
}

export interface EditableClipVersion {
  clipId: string;
  jobId: string;
  voiceover: string;
  visualPrompt: string;
  storagePath: string | null;
  storageUrl: string | null;
  createdAt: string;
  /** Tier this version was rendered at — pulled from this clip's job
   *  (jobs.resolution + jobs.model_tier). Surfaced in the header label
   *  so the user can see which version was rendered at which quality. */
  resolution: Resolution | null;
  modelTier: ModelTier | null;
}

export interface EditableClipCardProps {
  videoId: string;
  index: number;
  totalClips: number;
  durationS: number;
  versions: EditableClipVersion[]; // oldest -> newest
  selectedClipId: string;
  /** Which clip_id the current stitched video uses at this slot. The
   *  Apply button surfaces when selectedClipId ≠ displayedClipId — i.e.
   *  when the user has picked a version that DIFFERS from what the
   *  displayed video is built from. Previously this was hard-coded to
   *  "not on latest," which broke the case where the displayed video
   *  was stitched with a non-latest version: picking the latest then
   *  showed no Apply button (Yonah hit this on 2026-05-18 wanting v12
   *  when the stitched video used v11). */
  displayedClipId: string;
  onSelectVersion: (clipId: string) => void;
  resolution: Resolution | null;
  modelTier: ModelTier | null;
  /** Triggered when the user clicks "Apply" on this clip's selected
   *  version. Owned by the parent (EditableClipList) since compose
   *  uses the full selection map across all clips. */
  onApply?: () => void;
  /** True while a compose is running. Disables the Apply button on
   *  every card to prevent double-clicks from queuing two stitches. */
  applying?: boolean;
}

const SAVE_DEBOUNCE_MS = 800;

export function EditableClipCard({
  videoId,
  index,
  totalClips,
  durationS,
  versions,
  selectedClipId,
  displayedClipId,
  onSelectVersion,
  resolution,
  modelTier,
  onApply,
  applying = false,
}: EditableClipCardProps) {
  const router = useRouter();
  // The version the user is currently looking at + editing. Falls
  // back to latest if selectedClipId doesn't match anything (rare
  // — would only happen if the parent passes a stale id).
  const selected =
    versions.find((v) => v.clipId === selectedClipId)
    ?? versions[versions.length - 1];

  const [voiceover, setVoiceover] = useState(selected.voiceover);
  const [visualPrompt, setVisualPrompt] = useState(selected.visualPrompt);
  const [showVisual, setShowVisual] = useState(false);
  const [savedVoiceover, setSavedVoiceover] = useState(selected.voiceover);
  const [savedVisualPrompt, setSavedVisualPrompt] = useState(selected.visualPrompt);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  // Plain state instead of useTransition. The 20-min waitForJobTerminal
  // wait used to live inside a startTransition() — but in Next.js 16 /
  // React 19, navigation itself is a transition, and a long-running
  // transition queues subsequent transitions behind it. Result: while
  // a regen was in flight, clicking a sidebar link did nothing because
  // the navigation transition was waiting for ours to finish. Plain
  // useState keeps the in-flight render out of React's transition
  // tracking so navigation stays responsive.
  const [isRendering, setIsRendering] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync local state when the SELECTED version changes — either
  // because the user clicked a different version chip, or because a
  // re-render finished and the parent updated displayedClipIdByIndex.
  // We intentionally do NOT depend on selected.voiceover/.visualPrompt:
  // a parent re-fetch after a successful save would otherwise clobber
  // any new keystrokes the user typed during the round-trip.
  useEffect(() => {
    setVoiceover(selected.voiceover);
    setVisualPrompt(selected.visualPrompt);
    setSavedVoiceover(selected.voiceover);
    setSavedVisualPrompt(selected.visualPrompt);
    setSavingState('idle');
    setSaveError(null);
  }, [selected.clipId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear any pending "Saved · Live" indicator timeout on unmount.
  useEffect(() => {
    return () => {
      if (savedIndicatorTimerRef.current) {
        clearTimeout(savedIndicatorTimerRef.current);
      }
    };
  }, []);

  // Whether the saved-to-DB text has been rendered into the SELECTED
  // version's mp4 (i.e. the version being previewed in this card).
  const renderedVoiceover = selected.voiceover;
  const renderedVisualPrompt = selected.visualPrompt;
  const dbDirty = savedVoiceover !== voiceover || savedVisualPrompt !== visualPrompt;
  const renderDirty =
    savedVoiceover !== renderedVoiceover || savedVisualPrompt !== renderedVisualPrompt;

  // Debounced save on every change. Writes to the SELECTED clip row's
  // voiceover/visual_prompt so editing what you see edits what you'll
  // re-render.
  useEffect(() => {
    if (!dbDirty) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSavingState('saving');
      setSaveError(null);
      const r = await updateClipText({
        clipId: selected.clipId,
        voiceover,
        visualPrompt,
      });
      if ('error' in r) {
        setSavingState('error');
        setSaveError(r.error);
        return;
      }
      setSavedVoiceover(voiceover);
      setSavedVisualPrompt(visualPrompt);
      setSavingState('saved');
      if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
      savedIndicatorTimerRef.current = setTimeout(() => setSavingState('idle'), 1500);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [voiceover, visualPrompt, selected.clipId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default the tier picker to whatever the SELECTED version was
  // rendered at; fall back to the page-level tier prop if the version
  // doesn't carry per-version tier (legacy clips). Picker state is
  // per-card so each clip can be re-rendered at a different tier.
  const initialPickedResolution = selected.resolution ?? resolution ?? null;
  const initialPickedTier = selected.modelTier ?? modelTier ?? null;
  const [pickedResolution, setPickedResolution] = useState<Resolution | null>(initialPickedResolution);
  const [pickedTier, setPickedTier] = useState<ModelTier | null>(initialPickedTier);

  // Re-sync the picker when the selected version changes (so default
  // tracks the picked version's tier) — only when selected.clipId
  // actually changed, not on every prop pass.
  useEffect(() => {
    setPickedResolution(selected.resolution ?? resolution ?? null);
    setPickedTier(selected.modelTier ?? modelTier ?? null);
  }, [selected.clipId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cost = pickedResolution && pickedTier
    ? estimateSeedanceCost(durationS, pickedResolution, pickedTier)
    : null;
  const costStr = cost !== null ? `$${cost.toFixed(2)}` : null;
  const pickedTierLabel = tierLabel(pickedResolution, pickedTier);

  // Disable when (a) nothing to render, (b) already rendering, or (c) a
  // save is in flight. (c) is defensive — handleReRender flushes a
  // pending debounce inline before dispatching, but if savingState is
  // already 'saving' (debounce fired naturally) the click would race
  // with the in-progress write.
  const reRenderDisabled = !renderDirty || isRendering || savingState === 'saving';
  const renderLabel = isRendering
    ? 'Re-rendering…'
    : `Re-render this clip${pickedTierLabel ? ` · ${pickedTierLabel}` : ''}${costStr ? ` · ~${costStr}` : ''} · ~30s`;

  function handleReRender() {
    setRenderError(null);
    setIsRendering(true);
    (async () => {
      try {
        // Flush any pending debounced save BEFORE dispatching the render.
        // Without this, a user who types in the textarea and clicks
        // Re-render within the 800ms debounce window sends the OLD text
        // to Seedance — the save hadn't yet fired when the regen action
        // hit Modal, so Modal read stale voiceover/visual_prompt from
        // the clip row. Yonah's 2026-05-14 complaint: "it didn't even
        // keep the text changes I made in the script and the scene
        // direction... it's literally stealing." Cause was this race.
        //
        // dbDirty=true means the textarea diverges from the last saved
        // value. Cancel any pending debounce and run the save inline.
        if (dbDirty) {
          if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
          }
          setSavingState('saving');
          setSaveError(null);
          const saveR = await updateClipText({
            clipId: selected.clipId,
            voiceover,
            visualPrompt,
          });
          if ('error' in saveR) {
            setSavingState('error');
            setSaveError(saveR.error);
            setRenderError(
              `Couldn't save your edits before rendering: ${saveR.error}. ` +
              `Render not started — try again.`,
            );
            return;
          }
          setSavedVoiceover(voiceover);
          setSavedVisualPrompt(visualPrompt);
          setSavingState('saved');
          if (savedIndicatorTimerRef.current) {
            clearTimeout(savedIndicatorTimerRef.current);
          }
          savedIndicatorTimerRef.current = setTimeout(
            () => setSavingState('idle'), 1500,
          );
        }

        const r = await regenClipFromText({
          videoId,
          clipIndex: index,
          // Pass the chip's clip_id so the regen parents off the version
          // the user is actually viewing/editing, not the top-player
          // video's job. Without this, editing a non-latest chip's text
          // and hitting Re-render sends the OTHER version's text to
          // Seedance — Yonah's 2026-05-17 Shavuot V8/V9 bug.
          clipId: selected.clipId,
          resolution: pickedResolution ?? undefined,
          modelTier: pickedTier ?? undefined,
        });
        if ('error' in r) {
          setRenderError(r.error);
          return;
        }

        // Modal kicks the work off async — the action returned as soon
        // as the job was queued. Wait until the job hits a terminal
        // status so the button stays in "Re-rendering…" the whole time
        // and the page only refreshes once the new mp4 + stitched
        // video are actually ready. Realtime is the primary path
        // (instant on status update); 8s polling fallback handles
        // dropped Realtime messages. 20-min cap accommodates the
        // 9-10 min Seedance runs we've observed.
        const result = await waitForJobTerminal(r.jobId, 20 * 60 * 1000);
        if (result.status === 'failed') {
          setRenderError(friendlyRenderError(result.errorMessage));
        } else if (result.status === 'timeout') {
          setRenderError(
            'Render is still running after 20 minutes. Refresh the page to check on it.',
          );
        }

        router.refresh();
      } finally {
        setIsRendering(false);
      }
    })();
  }

  // `selected` (computed at top) is the version this card's preview +
  // textareas + Re-render all operate on. The aliases below preserve
  // the existing JSX naming.
  const sel = selected;
  const selectedIndex = versions.findIndex((v) => v.clipId === selectedClipId);
  const displayedSelectedIndex = selectedIndex >= 0 ? selectedIndex : versions.length - 1;

  return (
    <section
      style={{
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        padding: '20px 22px',
        background: 'var(--linen-50)',
        marginBottom: 18,
      }}
      id={`clip-${index}`}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: 17,
            margin: 0,
            color: 'var(--ink-900)',
          }}
        >
          Clip {index + 1} of {totalClips}
        </h3>
        <span
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: 12.5,
            color: 'var(--ink-500)',
          }}
        >
          {durationS.toFixed(1)}s
          {(() => {
            // Per-version tier label — shows what model rendered the
            // currently-displayed version. When versions span multiple
            // tiers the label updates as the user flips chips.
            const selTier = tierLabel(sel.resolution, sel.modelTier);
            return selTier ? ` · ${selTier}` : '';
          })()}
          {' · '}v{displayedSelectedIndex + 1} of {versions.length}
        </span>
      </header>

      {sel.storageUrl ? (
        <video
          controls
          src={sel.storageUrl}
          style={{
            width: '100%',
            maxWidth: 280,
            aspectRatio: '9 / 16',
            background: 'var(--ink-900)',
            borderRadius: 'var(--r-md)',
            marginBottom: 14,
            display: 'block',
          }}
        />
      ) : null}

      <label
        style={{
          display: 'block',
          fontFamily: 'var(--ff-body)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--cedar-600)',
          marginBottom: 4,
        }}
      >
        Voiceover
      </label>
      <textarea
        value={voiceover}
        onChange={(e) => setVoiceover(e.target.value)}
        rows={3}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: 'var(--ff-reading)',
          fontSize: 14.5,
          lineHeight: 1.6,
          padding: '10px 12px',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-sm)',
          background: 'white',
          resize: 'vertical',
          outline: 'none',
        }}
      />
      {(() => {
        // Live words-per-second indicator. Mirrors the same constants the
        // backend uses (WPS_HARD_CAP=3.0, TARGET_WPS=2.6, MAX_DURATION_S=15)
        // in modal_app.py's regen_clip_from_text. If you type past the cap,
        // the indicator turns red and tells you how long the auto-extend
        // backstop will make the clip — so you see the consequence before
        // hitting Re-render.
        const WPS_TARGET = 2.6;
        const WPS_CAP = 3.0;
        const MAX_DURATION = 15;
        const wordCount = voiceover.trim() === ''
          ? 0
          : voiceover.trim().split(/\s+/).length;
        const wps = durationS > 0 ? wordCount / durationS : 0;
        const overCap = wps > WPS_CAP;
        const nearCap = !overCap && wps > WPS_TARGET;
        const color = overCap
          ? 'var(--tassel)'
          : nearCap
          ? 'var(--cedar-600)'
          : 'var(--ink-400)';
        const projectedDuration = wordCount > 0
          ? Math.min(MAX_DURATION, Math.max(durationS, Math.ceil(wordCount / WPS_TARGET)))
          : durationS;
        const willAutoExtend = overCap && projectedDuration > durationS;
        const stillOverAtCap = overCap && wordCount / MAX_DURATION > WPS_CAP;
        return (
          <p
            style={{
              fontFamily: 'var(--ff-body)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 12,
              color,
              margin: '4px 0 10px',
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>
              <strong style={{ fontWeight: 600 }}>
                {wps.toFixed(1)} words/sec
              </strong>
              {' · '}
              {wordCount} word{wordCount === 1 ? '' : 's'} in {durationS.toFixed(1)}s
            </span>
            {willAutoExtend && (
              <span
                style={{
                  fontStyle: 'italic',
                  fontFamily: 'var(--ff-display)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 50',
                }}
              >
                {stillOverAtCap
                  ? `Re-render will use the 15s cap (${(wordCount / MAX_DURATION).toFixed(1)} wps — still tight). Trim text or split this clip.`
                  : `Re-render will extend to ~${projectedDuration}s to fit at ${WPS_TARGET} wps.`}
              </span>
            )}
            {nearCap && (
              <span
                style={{
                  fontStyle: 'italic',
                  fontFamily: 'var(--ff-display)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 50',
                }}
              >
                Above the {WPS_TARGET} target but below the {WPS_CAP} cap.
              </span>
            )}
          </p>
        );
      })()}
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: 12,
          color: 'var(--ink-500)',
          margin: '4px 0 12px',
        }}
      >
        This is the exact text Seedance will speak. Edit pronunciations, words,
        or remove the move announcement.
      </p>

      <button
        type="button"
        onClick={() => setShowVisual((s) => !s)}
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: 12.5,
          color: 'var(--ink-500)',
          background: 'none',
          border: 'none',
          padding: 0,
          textDecoration: 'underline',
          textUnderlineOffset: 3,
          cursor: 'pointer',
          marginBottom: showVisual ? 8 : 12,
        }}
      >
        {showVisual ? 'Hide scene direction' : 'Show scene direction'}
      </button>

      {showVisual && (
        <>
          <textarea
            value={visualPrompt}
            onChange={(e) => setVisualPrompt(e.target.value)}
            rows={6}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontFamily: 'var(--ff-reading)',
              fontSize: 13.5,
              lineHeight: 1.55,
              padding: '10px 12px',
              border: '1px solid var(--ink-200)',
              borderRadius: 'var(--r-sm)',
              background: 'white',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          <p
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: 12,
              color: 'var(--ink-500)',
              margin: '4px 0 12px',
            }}
          >
            Tells Seedance what the clip should look like. Add details like
            &ldquo;navy knit kippah, sits flat on crown&rdquo; if visuals
            drift.
          </p>
        </>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: 12,
            color:
              savingState === 'error' ? 'var(--tassel)' :
              dbDirty ? 'var(--cedar-500)' :
              renderDirty ? 'var(--cedar-500)' :
              'var(--ink-400)',
          }}
        >
          {savingState === 'saving' ? 'Saving…' :
            savingState === 'error' ? `Save failed: ${saveError}` :
            dbDirty ? 'Unsaved changes' :
            renderDirty ? 'Edits not yet rendered' :
            'Saved · Live'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={
            pickedResolution && pickedTier
              ? `${pickedResolution}|${pickedTier}`
              : ''
          }
          onChange={(e) => {
            const [r, t] = e.target.value.split('|') as [Resolution, ModelTier];
            setPickedResolution(r);
            setPickedTier(t);
          }}
          disabled={isRendering}
          aria-label="Re-render quality"
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: 13,
            padding: '10px 14px',
            minHeight: 44,
            borderRadius: '999px',
            border: '1px solid var(--ink-200)',
            background: 'white',
            color: 'var(--ink-800)',
            cursor: isRendering ? 'not-allowed' : 'pointer',
          }}
        >
          {TIER_OPTIONS.map((opt) => (
            <option
              key={`${opt.resolution}|${opt.tier}`}
              value={`${opt.resolution}|${opt.tier}`}
            >
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleReRender}
          disabled={reRenderDisabled}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: 13.5,
            padding: '11px 20px',
            minHeight: 44,
            borderRadius: '999px',
            border: '1px solid var(--jade)',
            background: reRenderDisabled ? 'var(--ink-200)' : 'var(--jade)',
            color: 'var(--linen-50)',
            cursor: reRenderDisabled ? 'not-allowed' : 'pointer',
            opacity: reRenderDisabled ? 0.6 : 1,
          }}
        >
          {renderLabel}
        </button>
      </div>
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: 12,
          color: 'var(--ink-400)',
          margin: '6px 0 0 0',
        }}
      >
        Pick the quality before re-rendering. Higher quality = sharper visuals + better lip-sync, more cost.
      </p>
      {renderError && (
        <p style={{ fontSize: 12.5, color: 'var(--tassel)', marginTop: 8 }}>
          {renderError}
        </p>
      )}

      {versions.length > 1 && (() => {
        const selIdx = versions.findIndex((v) => v.clipId === selectedClipId);
        // Apply surfaces when the user's pick differs from what's in the
        // displayed stitched video at this slot — not just "not on
        // latest." The stitched video might be built with a non-latest
        // version (e.g. Yonah wanted v12 when the current stitch used v11).
        const differsFromDisplayed = selectedClipId !== displayedClipId;
        const applyEnabled = !!onApply && !applying && differsFromDisplayed;
        return (
          <div style={{ marginTop: 16 }}>
            <p
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--cedar-600)',
                margin: '0 0 6px 0',
              }}
            >
              Versions
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {versions.map((v, i) => {
                const isSelected = v.clipId === selectedClipId;
                const isLatest = i === versions.length - 1;
                return (
                  <button
                    key={v.clipId}
                    type="button"
                    onClick={() => onSelectVersion(v.clipId)}
                    style={{
                      fontFamily: 'var(--ff-body)',
                      fontSize: 12,
                      padding: '6px 12px',
                      minHeight: 36,
                      borderRadius: '999px',
                      border: isSelected
                        ? '1.5px solid var(--navy-700)'
                        : '1px solid var(--ink-200)',
                      background: isSelected ? 'var(--navy-wash)' : 'white',
                      color: isSelected ? 'var(--navy-800)' : 'var(--ink-700)',
                      cursor: 'pointer',
                    }}
                  >
                    v{i + 1}{isLatest ? ' (latest)' : ''}
                  </button>
                );
              })}
              {differsFromDisplayed && (
                <button
                  type="button"
                  onClick={onApply}
                  disabled={!applyEnabled}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontFamily: 'var(--ff-body)',
                    fontWeight: 500,
                    fontSize: 13,
                    padding: '8px 16px',
                    minHeight: 36,
                    borderRadius: '999px',
                    border: '1px solid var(--navy-800)',
                    background: applyEnabled ? 'var(--navy-800)' : 'var(--ink-200)',
                    color: 'var(--linen-50)',
                    cursor: applyEnabled ? 'pointer' : 'not-allowed',
                    opacity: applyEnabled ? 1 : 0.6,
                    marginLeft: 4,
                  }}
                >
                  {applying
                    ? 'Stitching…'
                    : `Apply v${selIdx + 1} · stitch new video`}
                </button>
              )}
            </div>
            <p
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: 12,
                color: 'var(--ink-500)',
                margin: '6px 0 0',
              }}
            >
              {differsFromDisplayed
                ? 'Apply stitches a new final video with this pick. Other clips keep their currently-used version unless you also picked something different there. ~30s, no Seedance cost.'
                : 'This version is what the current video uses. Pick a different one to stitch a new final video.'}
            </p>
          </div>
        );
      })()}
    </section>
  );
}
