// dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx
//
// Phase 2: Plan review. Each clip is a compact card:
//   - Header: clip label + duration input + remove (×)
//   - Voiceover textarea (primary surface, auto-sized, no label)
//   - WPS indicator
//   - Action chip row: ▸ Scene direction · + Move · + Refs
//     · Scene direction expands inline within the card
//     · Move opens MotionPickerSheet (bottom sheet)
//     · Refs opens ReferenceImagePickerSheet (bottom sheet)
//   - Chain-broken note (compact, only when relevant)
//
// Two ways to generate:
//   - Sticky bottom "Generate all N clips →" (primary, filled navy) —
//     for the operator who's ready to commit.
//   - Per-card "▶ Generate this clip" (secondary, outlined navy) —
//     for the operator who wants to render one clip at a time, review,
//     then continue. Footer-aligned per card so it doesn't compete with
//     the bottom primary. Hidden once the clip has rendered
//     (clip.storage_path is set); a green "✓ Rendered" tick takes its
//     place. Re-render of done clips happens in Phase 3.
//
// Realtime subscription on clips via useRealtimeRows.

'use client';
import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useLocalStorageDraft } from '@/hooks/use-localstorage-draft';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';
import { analyzeClip } from '@/lib/word-count';
import type { TaiChiMove } from '@/lib/tai-chi-moves';
import { savePlanClip } from '@/app/actions/video-page/save-plan-clip';
import { savePlanClipMotion } from '@/app/actions/video-page/save-plan-clip-motion';
import { savePlanClipRefs } from '@/app/actions/video-page/save-plan-clip-refs';
import { removePlanClip } from '@/app/actions/video-page/remove-plan-clip';
import { breakClipChain } from '@/app/actions/video-page/break-clip-chain';
import { triggerClips } from '@/app/actions/video-page/trigger-clips';
import { MotionPickerSheet } from './_shared/motion-picker-sheet';
import {
  ReferenceImagePickerSheet,
  type RefImage,
} from './_shared/reference-image-picker-sheet';
import { BottomSheet } from './bottom-sheet';

const MAX_REF_IMAGES = 9;
const DURATION_MIN = 3;
const DURATION_MAX = 15;

interface Clip {
  id: string;
  index: number;
  voiceover: string;
  visual_prompt: string;
  duration_s: number | null;
  storage_path: string | null;
  motion_ref_slug: string | null;
  reference_image_paths: string[] | null;
  chain_broken: boolean;
}

interface Props {
  parshaSlug: string;
  jobId: string; // the plan-only job — used to subscribe to clip updates
  clipPlanId: string;
  initialClips: Clip[]; // sorted by index
  totalCostEstimateUsd: number | null;
  tierLabel: string; // e.g. "720p Fast"
  moves: TaiChiMove[]; // server-fetched library, passed in from page-new
  refImageLibrary: RefImage[]; // server-fetched, passed in from page-new
  onAdvance: () => void; // called after triggering all clips
  onBack: () => void;
}

export function Phase2PlanReview({
  parshaSlug,
  jobId,
  clipPlanId,
  initialClips,
  totalCostEstimateUsd,
  tierLabel,
  moves,
  refImageLibrary,
  onAdvance,
  onBack,
}: Props) {
  const [generating, setGenerating] = useState(false);

  // Realtime subscription keeps the card list fresh as Modal writes clips.
  const clips = useRealtimeRows<Clip>('clips', 'job_id', jobId, initialClips).sort(
    (a, b) => a.index - b.index,
  );

  async function generateAll() {
    setGenerating(true);
    try {
      await triggerClips(clipPlanId, null);
      onAdvance();
    } catch (e) {
      toast.error("Couldn't start clip generation.", {
        description: (e as Error).message,
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section>
      {/* Header strip: two-line so cost can't truncate on narrow widths */}
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontSize: 17,
            fontWeight: 500,
            color: 'var(--ink-900)',
            letterSpacing: '-0.01em',
          }}
        >
          {clips.length} {clips.length === 1 ? 'clip' : 'clips'}
        </div>
        {totalCostEstimateUsd !== null && (
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: 12.5,
              color: 'var(--ink-500)',
              marginTop: 2,
            }}
          >
            ~${totalCostEstimateUsd.toFixed(2)} estimated at {tierLabel}
          </div>
        )}
      </div>

      {clips.map((c) => (
        <PlanClipCard
          key={c.id}
          clip={c}
          clipPlanId={clipPlanId}
          parshaSlug={parshaSlug}
          moves={moves}
          refImageLibrary={refImageLibrary}
        />
      ))}

      {/* Sticky bottom action bar per spec §7 */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'white',
          borderTop: '1px solid var(--ink-100)',
          padding: '10px 0 max(16px, env(safe-area-inset-bottom))',
          marginTop: 16,
        }}
      >
        {/* Primary: filled navy — "Generate all N clips" */}
        <button
          type="button"
          onClick={generateAll}
          disabled={generating}
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
            cursor: generating ? 'wait' : 'pointer',
            opacity: generating ? 0.7 : 1,
          }}
        >
          {generating ? 'Starting…' : `Generate all ${clips.length} clips →`}
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
            ← Back to script
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-clip card
// ---------------------------------------------------------------------------

interface CardProps {
  clip: Clip;
  clipPlanId: string;
  parshaSlug: string;
  moves: TaiChiMove[];
  refImageLibrary: RefImage[];
}

function PlanClipCard({ clip, clipPlanId, parshaSlug, moves, refImageLibrary }: CardProps) {
  const [motionPickerOpen, setMotionPickerOpen] = useState(false);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [removeSheetOpen, setRemoveSheetOpen] = useState(false);
  const [sceneExpanded, setSceneExpanded] = useState(false);
  const [motionSlug, setMotionSlug] = useState<string | null>(clip.motion_ref_slug);
  const [refPaths, setRefPaths] = useState<string[]>(clip.reference_image_paths ?? []);
  const [chainBroken, setChainBroken] = useState<boolean>(clip.chain_broken);
  const [removing, setRemoving] = useState(false);
  const [breakingChain, setBreakingChain] = useState(false);
  // Per-clip render state: true between the operator tapping "Generate this clip"
  // and Modal writing storage_path back via realtime. Local because Modal doesn't
  // expose a per-clip "in-flight" flag — we rely on storage_path appearance.
  const [thisRendering, setThisRendering] = useState(false);

  // Clear the local rendering flag the moment storage_path appears in the
  // realtime-updated clip row. Covers the success path and also a cross-tab
  // generation completed by another session.
  useEffect(() => {
    if (clip.storage_path) setThisRendering(false);
  }, [clip.storage_path]);

  async function generateThisClip() {
    if (thisRendering) return;
    setThisRendering(true);
    try {
      await triggerClips(clipPlanId, [clip.index]);
    } catch (e) {
      setThisRendering(false);
      toast.error("Couldn't start clip generation.", {
        description: (e as Error).message,
      });
    }
  }

  // Duration state — local for the number input, persisted on blur/change.
  const [durationS, setDurationS] = useState<number>(clip.duration_s ?? 10);

  const [voTxt, setVoTxt, clearVoDraft] = useLocalStorageDraft(
    `plan.${parshaSlug}.${clip.id}.voiceover`,
    clip.voiceover,
  );
  const [scTxt, setScTxt, clearScDraft] = useLocalStorageDraft(
    `plan.${parshaSlug}.${clip.id}.scene`,
    clip.visual_prompt,
  );

  const voSave = useOptimisticSave<string>({
    current: voTxt,
    save: async (next) => {
      await savePlanClip(clip.id, { voiceover: next });
    },
    onSuccess: clearVoDraft,
    errorMessage: "Couldn't save voiceover.",
  });

  const scSave = useOptimisticSave<string>({
    current: scTxt,
    save: async (next) => {
      await savePlanClip(clip.id, { visual_prompt: next });
    },
    onSuccess: clearScDraft,
    errorMessage: "Couldn't save scene direction.",
  });

  const fb = analyzeClip(voTxt, durationS);
  const currentMove = moves.find((m) => m.slug === motionSlug) ?? null;

  async function pickMotion(slug: string | null) {
    const prev = motionSlug;
    setMotionSlug(slug); // optimistic
    const result = await savePlanClipMotion(clip.id, slug, parshaSlug);
    if (!result.ok) {
      setMotionSlug(prev); // revert
      toast.error("Couldn't save the move.", { description: result.error });
    }
  }

  const addRef = useCallback(
    async (path: string) => {
      const next = [...refPaths, path].slice(0, MAX_REF_IMAGES);
      const prev = refPaths;
      setRefPaths(next); // optimistic
      const result = await savePlanClipRefs(clip.id, next, parshaSlug);
      if (!result.ok) {
        setRefPaths(prev);
        toast.error("Couldn't save reference images.", { description: result.error });
      }
    },
    [clip.id, parshaSlug, refPaths],
  );

  const removeRef = useCallback(
    async (path: string) => {
      const next = refPaths.filter((p) => p !== path);
      const prev = refPaths;
      setRefPaths(next); // optimistic
      // Pass null when empty so auto-select kicks back in.
      const result = await savePlanClipRefs(clip.id, next.length > 0 ? next : null, parshaSlug);
      if (!result.ok) {
        setRefPaths(prev);
        toast.error("Couldn't save reference images.", { description: result.error });
      }
    },
    [clip.id, parshaSlug, refPaths],
  );

  async function saveDuration(val: number) {
    const clamped = Math.max(DURATION_MIN, Math.min(DURATION_MAX, val));
    setDurationS(clamped);
    try {
      await savePlanClip(clip.id, { duration_s: clamped });
    } catch (e) {
      toast.error("Couldn't save duration.", { description: (e as Error).message });
    }
  }

  async function confirmRemove() {
    setRemoving(true);
    setRemoveSheetOpen(false);
    try {
      const result = await removePlanClip(clip.id, parshaSlug);
      if (!result.ok) {
        toast.error("Couldn't remove clip.", { description: result.error });
      }
      // On success the realtime subscription removes this card automatically.
    } catch (e) {
      toast.error("Couldn't remove clip.", { description: (e as Error).message });
    } finally {
      setRemoving(false);
    }
  }

  async function handleBreakChain() {
    if (breakingChain) return;
    setBreakingChain(true);
    const next = !chainBroken;
    const prev = chainBroken;
    setChainBroken(next); // optimistic
    const result = await breakClipChain(clip.id, next, parshaSlug);
    if (!result.ok) {
      setChainBroken(prev);
      toast.error("Couldn't update chain setting.", { description: result.error });
    }
    setBreakingChain(false);
  }

  // Ref image section: is chaining active?
  // Chaining is active when: NOT chainBroken AND this is not clip 0
  // (clip 0 can't be chained — there's no previous clip).
  // We approximate: show the banner when clip.index > 0 && !chainBroken
  // because the actual chaining decision also depends on setting_id
  // (which we don't know client-side). The banner is informational;
  // the worst case is an unnecessary banner on clip 1 if setting differs.
  const chainedBannerVisible = clip.index > 0 && !chainBroken;

  const refCount = refPaths.length;
  const refSlotsFull = refCount >= MAX_REF_IMAGES;

  return (
    <div
      style={{
        border: '1px solid var(--ink-100)',
        borderRadius: 12,
        padding: '16px 16px 14px',
        marginBottom: 14,
        background: 'white',
        opacity: removing ? 0.5 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      {/* Compact header: clip label + duration + remove */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontFamily: 'var(--ff-body)',
              fontSize: 10.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--cedar-600)',
              fontWeight: 600,
            }}
          >
            Clip {clip.index + 1}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input
              id={`dur-${clip.id}`}
              type="number"
              min={DURATION_MIN}
              max={DURATION_MAX}
              step={1}
              value={durationS}
              aria-label={`Clip ${clip.index + 1} duration in seconds`}
              onChange={(e) => setDurationS(Number(e.target.value))}
              onBlur={(e) => saveDuration(Number(e.target.value))}
              style={{
                width: 40,
                height: 26,
                fontSize: 13,
                textAlign: 'center',
                border: '1px solid var(--ink-100)',
                borderRadius: 5,
                background: 'white',
                padding: '2px 4px',
                boxSizing: 'border-box',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>s</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRemoveSheetOpen(true)}
          disabled={removing}
          aria-label="Remove this clip"
          style={{
            width: 32,
            height: 32,
            padding: 0,
            fontSize: 18,
            lineHeight: 1,
            background: 'transparent',
            color: 'var(--ink-500)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>

      {/* Voiceover — primary surface, no label, auto-grows */}
      <textarea
        value={voTxt}
        ref={(el) => { if (el) autoSize(el); }}
        onChange={(e) => {
          autoSize(e.currentTarget);
          setVoTxt(e.target.value);
          voSave.update(e.target.value);
        }}
        placeholder="Voiceover…"
        style={{
          width: '100%',
          minHeight: 110,
          padding: '14px 16px',
          fontSize: 16,
          lineHeight: 1.55,
          border: '1px solid var(--ink-100)',
          borderRadius: 10,
          background: 'var(--linen-50)',
          fontFamily: 'var(--ff-reading, var(--ff-body))',
          color: 'var(--ink-900)',
          resize: 'none',
          overflow: 'hidden',
          boxSizing: 'border-box',
          outline: 'none',
        }}
      />
      <div
        style={{
          fontSize: 11.5,
          color: 'var(--ink-500)',
          marginTop: 6,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <span>{fb.words} words</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>{fb.wps.toFixed(1)} wps</span>
        {fb.warning === 'tight' ? (
          <span style={{ color: 'var(--tassel)', marginLeft: 2 }}>⚠ tight</span>
        ) : (
          <span style={{ color: 'var(--jade)', marginLeft: 2 }}>✓</span>
        )}
      </div>

      {/* Compact action chip row */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginTop: 14,
          flexWrap: 'wrap',
        }}
      >
        <Chip
          active={sceneExpanded}
          onClick={() => setSceneExpanded((s) => !s)}
          ariaExpanded={sceneExpanded}
        >
          <span style={{ display: 'inline-block', width: 10, transform: sceneExpanded ? 'rotate(90deg)' : 'none', transition: 'transform var(--trans)' }}>▸</span>
          {' '}Scene direction
        </Chip>
        <Chip
          filled={!!currentMove}
          onClick={() => setMotionPickerOpen(true)}
        >
          {currentMove ? `🥋 ${currentMove.english}` : '+ Move'}
        </Chip>
        <Chip
          filled={refPaths.length > 0}
          onClick={() => setRefPickerOpen(true)}
        >
          {refPaths.length > 0
            ? `📷 ${refPaths.length} ref${refPaths.length === 1 ? '' : 's'}`
            : '+ Refs'}
        </Chip>
      </div>

      {/* Inline expansion: scene direction */}
      {sceneExpanded && (
        <div style={{ marginTop: 10 }}>
          <textarea
            value={scTxt}
            ref={(el) => { if (el) autoSize(el); }}
            onChange={(e) => {
              autoSize(e.currentTarget);
              setScTxt(e.target.value);
              scSave.update(e.target.value);
            }}
            placeholder="Describe the visual scene…"
            style={{
              width: '100%',
              minHeight: 90,
              padding: '12px 14px',
              fontSize: 16,
              lineHeight: 1.55,
              border: '1px solid var(--ink-100)',
              borderRadius: 10,
              background: 'var(--linen-50)',
              fontFamily: 'var(--ff-reading, var(--ff-body))',
              color: 'var(--ink-900)',
              resize: 'none',
              overflow: 'hidden',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* Chain-broken note — only visible when relevant, kept compact */}
      {chainedBannerVisible && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-500)', lineHeight: 1.5 }}>
          Chained from previous clip&apos;s last frame; refs ignored.{' '}
          <button
            type="button"
            onClick={handleBreakChain}
            disabled={breakingChain}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--navy-700)',
              textDecoration: 'underline',
              fontSize: 11.5,
              cursor: breakingChain ? 'wait' : 'pointer',
            }}
          >
            {breakingChain ? 'Updating…' : 'Break chain'}
          </button>
        </div>
      )}
      {chainBroken && clip.index > 0 && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-500)', lineHeight: 1.5 }}>
          Chain broken — refs active.{' '}
          <button
            type="button"
            onClick={handleBreakChain}
            disabled={breakingChain}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--ink-500)',
              textDecoration: 'underline',
              fontSize: 11.5,
              cursor: breakingChain ? 'wait' : 'pointer',
            }}
          >
            {breakingChain ? 'Updating…' : 'Restore chain'}
          </button>
        </div>
      )}

      {/* Per-card generate — outlined / secondary so it doesn't compete with
          the sticky bottom "Generate all". Hidden once this clip has rendered
          (clip.storage_path !== null); Phase 3 handles re-render of done clips. */}
      {!clip.storage_path && (
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={generateThisClip}
            disabled={thisRendering}
            aria-busy={thisRendering}
            style={{
              minHeight: 40,
              fontSize: 13,
              fontWeight: 500,
              padding: '8px 14px',
              borderRadius: 8,
              background: 'white',
              color: thisRendering ? 'var(--ink-500)' : 'var(--navy-700)',
              border: '1px solid var(--navy-700)',
              cursor: thisRendering ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {thisRendering ? (
              <>
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    border: '2px solid var(--ink-200)',
                    borderTopColor: 'var(--navy-700)',
                    animation: 'spin 0.9s linear infinite',
                    display: 'inline-block',
                  }}
                />
                Rendering this clip…
              </>
            ) : (
              <>▶ Generate this clip</>
            )}
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {clip.storage_path && (
        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: 'var(--jade)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span aria-hidden="true">✓</span> Rendered
        </div>
      )}

      {/* Bottom sheets — rendered via portal, hidden when closed */}
      <MotionPickerSheet
        open={motionPickerOpen}
        onOpenChange={setMotionPickerOpen}
        moves={moves}
        currentSlug={motionSlug}
        onPick={pickMotion}
      />
      <ReferenceImagePickerSheet
        open={refPickerOpen}
        onOpenChange={setRefPickerOpen}
        library={refImageLibrary}
        selected={refPaths}
        onAdd={addRef}
        onRemove={removeRef}
      />
      <BottomSheet
        open={removeSheetOpen}
        onOpenChange={setRemoveSheetOpen}
        title={`Remove Clip ${clip.index + 1}?`}
        primaryAction={{
          label: 'Remove clip',
          onClick: confirmRemove,
          destructive: true,
        }}
        secondaryAction={{
          label: 'Cancel',
          onClick: () => setRemoveSheetOpen(false),
        }}
      >
        Any rendered clip mp4 is also deleted. This can&apos;t be undone.
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Auto-resize a textarea to fit its content. Called on mount via ref
 * callback and on every change. Sets height to scrollHeight after
 * resetting to 'auto' so it can both grow and shrink as text changes.
 */
function autoSize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * Compact pill button used for the per-card action row (Scene direction,
 * Move, Refs). White when empty, linen-tinted when active/filled. Active
 * = section currently expanded; filled = has a value attached.
 */
function Chip({
  children,
  active,
  filled,
  onClick,
  ariaExpanded,
}: {
  children: React.ReactNode;
  active?: boolean;
  filled?: boolean;
  onClick: () => void;
  ariaExpanded?: boolean;
}) {
  const tinted = active || filled;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={ariaExpanded}
      style={{
        minHeight: 32,
        padding: '6px 12px',
        fontSize: 12.5,
        fontWeight: 500,
        fontFamily: 'var(--ff-body)',
        background: tinted ? 'var(--linen-100)' : 'white',
        color: tinted ? 'var(--ink-900)' : 'var(--ink-700)',
        border: `1px solid ${tinted ? 'var(--ink-200)' : 'var(--ink-100)'}`,
        borderRadius: 999,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        transition: 'all var(--trans)',
      }}
    >
      {children}
    </button>
  );
}
