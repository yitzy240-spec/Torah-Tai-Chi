'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateClipText } from '@/app/actions/update-clip-text';
import { regenClipFromText } from '@/app/actions/regen-clip-from-text';
import { estimateSeedanceCost, type Resolution, type ModelTier } from '@/lib/seedance-pricing';

export interface EditableClipVersion {
  clipId: string;
  jobId: string;
  voiceover: string;
  visualPrompt: string;
  storagePath: string | null;
  storageUrl: string | null;
  createdAt: string;
}

export interface EditableClipCardProps {
  videoId: string;
  index: number;
  totalClips: number;
  durationS: number;
  versions: EditableClipVersion[]; // oldest -> newest
  selectedClipId: string;
  onSelectVersion: (clipId: string) => void;
  resolution: Resolution | null;
  modelTier: ModelTier | null;
}

const SAVE_DEBOUNCE_MS = 800;

export function EditableClipCard({
  videoId,
  index,
  totalClips,
  durationS,
  versions,
  selectedClipId,
  onSelectVersion,
  resolution,
  modelTier,
}: EditableClipCardProps) {
  const router = useRouter();
  const latest = versions[versions.length - 1];

  const [voiceover, setVoiceover] = useState(latest.voiceover);
  const [visualPrompt, setVisualPrompt] = useState(latest.visualPrompt);
  const [showVisual, setShowVisual] = useState(false);
  const [savedVoiceover, setSavedVoiceover] = useState(latest.voiceover);
  const [savedVisualPrompt, setSavedVisualPrompt] = useState(latest.visualPrompt);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, startRender] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync local state only when a new version is added (latest.clipId
  // changes — e.g. after a re-render completes and `versions` grows, or
  // when the parent navigates between clips). We intentionally do NOT
  // depend on latest.voiceover/.visualPrompt: a parent re-fetch after a
  // successful save would otherwise clobber any new keystrokes the user
  // typed during the round-trip.
  useEffect(() => {
    setVoiceover(latest.voiceover);
    setVisualPrompt(latest.visualPrompt);
    setSavedVoiceover(latest.voiceover);
    setSavedVisualPrompt(latest.visualPrompt);
    setSavingState('idle');
    setSaveError(null);
  }, [latest.clipId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear any pending "Saved · Live" indicator timeout on unmount.
  useEffect(() => {
    return () => {
      if (savedIndicatorTimerRef.current) {
        clearTimeout(savedIndicatorTimerRef.current);
      }
    };
  }, []);

  // Whether the saved-to-DB text has been rendered into the latest clip mp4.
  const renderedVoiceover = latest.voiceover;
  const renderedVisualPrompt = latest.visualPrompt;
  const dbDirty = savedVoiceover !== voiceover || savedVisualPrompt !== visualPrompt;
  const renderDirty =
    savedVoiceover !== renderedVoiceover || savedVisualPrompt !== renderedVisualPrompt;

  // Debounced save on every change.
  useEffect(() => {
    if (!dbDirty) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSavingState('saving');
      setSaveError(null);
      const r = await updateClipText({
        clipId: latest.clipId,
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
  }, [voiceover, visualPrompt, latest.clipId]); // eslint-disable-line react-hooks/exhaustive-deps

  const cost = resolution && modelTier
    ? estimateSeedanceCost(durationS, resolution, modelTier)
    : null;
  const costStr = cost !== null ? `$${cost.toFixed(2)}` : null;

  const reRenderDisabled = !renderDirty || isRendering;
  const renderLabel = isRendering
    ? 'Re-rendering…'
    : `Re-render this clip${costStr ? ` · ~${costStr}` : ''} · ~30s`;

  function handleReRender() {
    setRenderError(null);
    startRender(async () => {
      const r = await regenClipFromText({ videoId, clipIndex: index });
      if ('error' in r) {
        setRenderError(r.error);
        return;
      }
      router.refresh();
    });
  }

  const sel = versions.find((v) => v.clipId === selectedClipId) ?? latest;
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
          {durationS.toFixed(1)}s · v{displayedSelectedIndex + 1} of {versions.length}
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
      {renderError && (
        <p style={{ fontSize: 12.5, color: 'var(--tassel)', marginTop: 8 }}>
          {renderError}
        </p>
      )}

      {/* Version chips intentionally hidden in this iteration —
          VideoVersionsView already provides version selection via ?v=
          URL param, and dual selectors disagree (this card's chips were
          local-state only). Re-enable when cross-component version
          selection is unified. */}
    </section>
  );
}
