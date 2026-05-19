// dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx
//
// Phase 2: Plan review. Per-clip cards with:
//   - Voiceover + scene direction text editing
//   - Duration control (3-15s)
//   - Tai Chi move picker
//   - Reference image picker (9-slot meter, chain-broken banner)
//   - Per-card remove action (bottom sheet confirm)
//   - Inline help text per feature
//   - Per-card "Generate this clip" (outlined secondary)
//
// Sticky bottom "Generate all N clips →" (filled primary). Realtime
// subscription on clips via useRealtimeRows.
//
// CTA hierarchy per spec §4:
//   - Per-card "Generate this clip" → OUTLINED secondary (not filled)
//   - Sticky "Generate all N clips →" → FILLED primary navy
//
// Per spec §4 Phase 2 + §B4.

'use client';
import { useState, useCallback } from 'react';
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
      {/* Header strip: clip count + cost estimate */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13,
          marginBottom: 14,
        }}
      >
        <span style={{ color: 'var(--ink-700)' }}>{clips.length} clips</span>
        {totalCostEstimateUsd !== null && (
          <span style={{ color: 'var(--ink-500)', fontStyle: 'italic', fontSize: 12 }}>
            Estimated cost: ~${totalCostEstimateUsd.toFixed(2)} at {tierLabel}
          </span>
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
  const [motionSlug, setMotionSlug] = useState<string | null>(clip.motion_ref_slug);
  const [refPaths, setRefPaths] = useState<string[]>(clip.reference_image_paths ?? []);
  const [chainBroken, setChainBroken] = useState<boolean>(clip.chain_broken);
  const [generatingThis, setGeneratingThis] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [breakingChain, setBreakingChain] = useState(false);

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

  async function generateThis() {
    setGeneratingThis(true);
    try {
      await triggerClips(clipPlanId, [clip.index]);
    } catch (e) {
      toast.error("Couldn't start clip generation.", {
        description: (e as Error).message,
      });
    } finally {
      setGeneratingThis(false);
    }
  }

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
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
        background: 'var(--linen-50)',
        opacity: removing ? 0.5 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      {/* Card header: clip label + duration + per-card generate + remove */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--ink-500)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              flexShrink: 0,
            }}
          >
            Clip {clip.index + 1}
          </span>
          {/* Duration inline control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <label
              style={{ fontSize: 11, color: 'var(--ink-500)', whiteSpace: 'nowrap' }}
              htmlFor={`dur-${clip.id}`}
            >
              ·
            </label>
            <input
              id={`dur-${clip.id}`}
              type="number"
              min={DURATION_MIN}
              max={DURATION_MAX}
              step={1}
              value={durationS}
              onChange={(e) => setDurationS(Number(e.target.value))}
              onBlur={(e) => saveDuration(Number(e.target.value))}
              style={{
                width: 44,
                minHeight: 32,
                fontSize: 14,
                textAlign: 'center',
                border: '1px solid var(--ink-100)',
                borderRadius: 6,
                background: 'white',
                padding: '4px 6px',
                boxSizing: 'border-box',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>s</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Secondary outlined generate button */}
          <button
            type="button"
            onClick={generateThis}
            disabled={generatingThis || removing}
            style={{
              minHeight: 44,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              background: 'white',
              color: 'var(--navy-700)',
              border: '1px solid var(--navy-700)',
              borderRadius: 8,
              cursor: generatingThis ? 'wait' : 'pointer',
              opacity: generatingThis ? 0.7 : 1,
            }}
          >
            {generatingThis ? 'Starting…' : 'Generate this clip'}
          </button>
          {/* Remove button */}
          <button
            type="button"
            onClick={() => setRemoveSheetOpen(true)}
            disabled={removing}
            title="Remove this clip"
            style={{
              minHeight: 44,
              minWidth: 44,
              padding: '8px 10px',
              fontSize: 16,
              background: 'white',
              color: 'var(--ink-500)',
              border: '1px solid var(--ink-100)',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Duration help text */}
      <p
        style={{
          margin: '0 0 10px',
          fontSize: 11,
          color: 'var(--ink-500)',
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}
      >
        Target clip length (3–15s). Seedance may adjust slightly to fit the voiceover at 2.6 words/sec.
      </p>

      {/* Voiceover */}
      <label
        style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 3 }}
      >
        Voiceover
      </label>
      <p
        style={{
          margin: '0 0 4px',
          fontSize: 11,
          color: 'var(--ink-500)',
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}
      >
        What the character speaks. Write Hebrew/pinyin words phonetically
        (ha-SHEM, t&apos;AI-chee) so Seedance pronounces them correctly.
      </p>
      <textarea
        value={voTxt}
        onChange={(e) => {
          setVoTxt(e.target.value);
          voSave.update(e.target.value);
        }}
        style={{
          width: '100%',
          minHeight: 64,
          padding: 8,
          fontSize: 16, // 16pt prevents iOS auto-zoom
          border: '1px solid var(--ink-100)',
          borderRadius: 6,
          background: 'white',
          fontFamily: 'inherit',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ fontSize: 10.5, color: 'var(--ink-500)', marginTop: 3 }}>
        {fb.words} words
        {durationS ? ` · ${fb.wps.toFixed(1)} wps` : ''}
        {fb.warning === 'tight' ? (
          <span style={{ color: 'var(--tassel)' }}> ⚠ tight</span>
        ) : (
          <span style={{ color: 'var(--jade)' }}> ✓</span>
        )}
      </div>

      {/* Scene direction */}
      <label
        style={{
          display: 'block',
          fontSize: 11,
          color: 'var(--ink-700)',
          margin: '10px 0 3px',
        }}
      >
        Scene direction
      </label>
      <p
        style={{
          margin: '0 0 4px',
          fontSize: 11,
          color: 'var(--ink-500)',
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}
      >
        Describes the visual scene Seedance generates. Be specific about setting, character pose, mood.
      </p>
      <textarea
        value={scTxt}
        onChange={(e) => {
          setScTxt(e.target.value);
          scSave.update(e.target.value);
        }}
        style={{
          width: '100%',
          minHeight: 64,
          padding: 8,
          fontSize: 16,
          border: '1px solid var(--ink-100)',
          borderRadius: 6,
          background: 'white',
          fontFamily: 'inherit',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />

      {/* Tai Chi move picker (spec §6.5) */}
      <label
        style={{
          display: 'block',
          fontSize: 11,
          color: 'var(--ink-700)',
          margin: '10px 0 3px',
        }}
      >
        Tai Chi move
      </label>
      <p
        style={{
          margin: '0 0 4px',
          fontSize: 11,
          color: 'var(--ink-500)',
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}
      >
        Optional motion reference — Seedance uses the move&apos;s video to guide the character&apos;s body movement.
      </p>
      <button
        type="button"
        onClick={() => setMotionPickerOpen(true)}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '10px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'white',
          border: '1px solid var(--ink-100)',
          borderRadius: 6,
          fontSize: 14,
          cursor: 'pointer',
          boxSizing: 'border-box',
        }}
      >
        <span>{currentMove ? `🥋 ${currentMove.english}` : 'No move assigned'}</span>
        <span style={{ color: 'var(--ink-500)' }}>▾</span>
      </button>

      <MotionPickerSheet
        open={motionPickerOpen}
        onOpenChange={setMotionPickerOpen}
        moves={moves}
        currentSlug={motionSlug}
        onPick={pickMotion}
      />

      {/* Reference images section */}
      <div style={{ margin: '10px 0 0' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 3,
          }}
        >
          <label style={{ fontSize: 11, color: 'var(--ink-700)' }}>
            Reference images
          </label>
          <span
            style={{
              fontSize: 11,
              color: refSlotsFull ? 'var(--tassel)' : 'var(--ink-500)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {refCount} of {MAX_REF_IMAGES} used
          </span>
        </div>
        <p
          style={{
            margin: '0 0 6px',
            fontSize: 11,
            color: 'var(--ink-500)',
            fontStyle: 'italic',
            lineHeight: 1.4,
          }}
        >
          Up to 9 images per clip — character anchor, dojo background, Jewish ritual props. Used to keep visuals consistent.
          {motionSlug && (
            <> Motion reference active — reference images still applied alongside motion.</>
          )}
        </p>

        {/* Chain-broken banner — shown when index > 0 and not yet broken */}
        {chainedBannerVisible ? (
          <div
            style={{
              background: 'var(--linen-100)',
              border: '1px solid var(--ink-100)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12,
              color: 'var(--ink-700)',
              lineHeight: 1.5,
              marginBottom: 8,
            }}
          >
            This clip is chained from the previous clip&apos;s last frame for visual continuity.
            Reference images are not used while chained.{' '}
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
                fontSize: 12,
                cursor: breakingChain ? 'wait' : 'pointer',
              }}
            >
              {breakingChain ? 'Updating…' : 'Break chain →'}
            </button>
          </div>
        ) : chainBroken && clip.index > 0 ? (
          <div
            style={{
              background: 'var(--linen-100)',
              border: '1px solid var(--ink-100)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12,
              color: 'var(--ink-700)',
              lineHeight: 1.5,
              marginBottom: 8,
            }}
          >
            Chain broken — reference images will be used.{' '}
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
                fontSize: 12,
                cursor: breakingChain ? 'wait' : 'pointer',
              }}
            >
              {breakingChain ? 'Updating…' : 'Restore chain'}
            </button>
          </div>
        ) : null}

        {/* Thumbnail row */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            paddingBottom: 4,
            alignItems: 'center',
          }}
        >
          {refPaths.map((path) => {
            const img = refImageLibrary.find((r) => r.path === path);
            return (
              <div
                key={path}
                style={{
                  position: 'relative',
                  flexShrink: 0,
                  width: 50,
                  height: 50,
                  borderRadius: 6,
                  border: '1px solid var(--ink-100)',
                  overflow: 'hidden',
                  background: 'var(--linen-50)',
                }}
              >
                {img?.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.thumbUrl}
                    alt={img.label}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      background: 'var(--ink-100)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      color: 'var(--ink-500)',
                      textAlign: 'center',
                      padding: 2,
                    }}
                  >
                    {img?.label ?? path.split('/').pop()}
                  </div>
                )}
                {/* Remove × button */}
                <button
                  type="button"
                  onClick={() => removeRef(path)}
                  title={`Remove ${img?.label ?? path}`}
                  style={{
                    position: 'absolute',
                    top: 1,
                    right: 1,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.55)',
                    border: 'none',
                    color: 'white',
                    fontSize: 10,
                    lineHeight: 1,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}

          {/* Add button */}
          <button
            type="button"
            onClick={() => setRefPickerOpen(true)}
            disabled={refSlotsFull}
            title={refSlotsFull ? 'Full — remove one to add another' : 'Add reference image'}
            style={{
              flexShrink: 0,
              width: 50,
              height: 50,
              borderRadius: 6,
              border: '1px dashed var(--ink-300)',
              background: 'white',
              cursor: refSlotsFull ? 'not-allowed' : 'pointer',
              opacity: refSlotsFull ? 0.45 : 1,
              fontSize: 20,
              color: 'var(--ink-500)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            +
          </button>
        </div>
      </div>

      <ReferenceImagePickerSheet
        open={refPickerOpen}
        onOpenChange={setRefPickerOpen}
        library={refImageLibrary}
        selected={refPaths}
        onAdd={addRef}
        onRemove={removeRef}
      />

      {/* Remove clip confirmation bottom sheet */}
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
