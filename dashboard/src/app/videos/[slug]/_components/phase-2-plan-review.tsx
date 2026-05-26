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
//   - Sticky bottom CTA — primary, filled navy. Context-aware:
//       0 rendered    → "Generate all N clips →"
//       partial done  → "Generate M remaining clips →" (only fires the
//                       unrendered subset so the operator doesn't re-pay
//                       for clips they already rendered one-by-one)
//       all rendered  → "Continue to clip review →" (just advances to
//                       Phase 3; no Modal call)
//   - Per-card "▶ Generate this clip" (secondary, outlined navy) —
//     for the operator who wants to render one clip at a time, review,
//     then continue. STRICTLY SEQUENTIAL: clip N's button is disabled
//     until clip N-1 has a rendered mp4. This is non-negotiable —
//     scene-group chaining uses clip N-1's last frame as clip N's
//     first frame for visual continuity; rendering out of order gives
//     Seedance a fresh roll of the room and produces a visible cut at
//     the boundary (the bug clips_only_job scene-group chaining was
//     shipped to fix in 2026-05-20). Disabled state shows a small
//     italic hint ("Generate clip N first") instead of the button.
//     Hidden entirely once the clip has rendered; a quiet jade
//     "✓ Rendered" tick takes its place. Re-render lives in Phase 3.
//
// Per-card failure detection: the operator-fired clips-only job is
// watched via useRealtimeRow so a Modal crash (asyncio, OOM, etc.)
// surfaces a toast with the error + a 'View log' link instead of
// spinning forever. A 4-minute hard timeout backs that up in case
// both realtime channels drop silently.
//
// Realtime subscription on clips via useRealtimeRows.

'use client';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useLocalStorageDraft } from '@/hooks/use-localstorage-draft';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';
import { useRealtimeRow } from '@/hooks/use-realtime-row';
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
import { TierPickerSheet, type TierChoice } from './_shared/tier-picker-sheet';
import { BottomSheet } from './bottom-sheet';
import { estimateSeedanceCost } from '@/lib/seedance-pricing';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';
import { publicVideoUrl } from '@/lib/storage-url';

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
  /** Latest rendered storage_path per clip index, from clips-only
   *  child jobs. Lives separately from initialClips so useRealtimeRows
   *  refetches don't wipe the player out — the render state is
   *  reconciled at display time via the renderedByIndex map below. */
  initialRenderedByIndex: Record<number, string>;
  initialResolution: Resolution; // default tier comes from the plan-only job (or fallback)
  initialModelTier: ModelTier;
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
  initialRenderedByIndex,
  initialResolution,
  initialModelTier,
  moves,
  refImageLibrary,
  onAdvance,
  onBack,
}: Props) {
  const [generating, setGenerating] = useState(false);
  // Tier state owned here so the picker + cost estimate + Generate handoff
  // share a single source of truth. Initialized from the plan-only job's
  // saved tier (or the NULL fallback). Picking a new option in the sheet
  // updates this, the cost line recomputes, and the next render fires at
  // the chosen tier (written to the clips-only job row in trigger-clips).
  const [tier, setTier] = useState<TierChoice>({
    resolution: initialResolution,
    modelTier: initialModelTier,
  });
  const [tierPickerOpen, setTierPickerOpen] = useState(false);

  // Realtime tracks ONLY the plan-only's own clip rows (those carry the
  // editable metadata — voiceover, scene direction, motion ref, etc.).
  // The rendered mp4 paths live in separate rows under clips-only
  // child jobs; they're carried in via initialRenderedByIndex from the
  // server and never overwritten by realtime refetches. We merge them
  // back in below for display so the inline player survives a refetch.
  const rawClips = useRealtimeRows<Clip>('clips', 'job_id', jobId, initialClips).sort(
    (a, b) => a.index - b.index,
  );
  const clips = rawClips.map((c) => ({
    ...c,
    storage_path: initialRenderedByIndex[c.index] ?? c.storage_path,
  }));

  const totalDurationS = clips.reduce((s, c) => s + (c.duration_s ?? 0), 0);
  const totalCostEstimateUsd =
    totalDurationS > 0 ? estimateSeedanceCost(totalDurationS, tier.resolution, tier.modelTier) : null;
  const tierLabel = `${tier.resolution} ${tier.modelTier === 'standard' ? 'Standard' : 'Fast'}`;

  // Bottom-button state machine, derived from how many clips have a
  // rendered mp4 already:
  //   0 done       → "Generate all N clips →"             fires triggerClips(planId, null)
  //   1..N-1 done  → "Generate M remaining clips →"       fires triggerClips(planId, [unrenderedIndexes])
  //   all N done   → "Continue to clip review →"          just navigates to Phase 3
  // This stops "Generate all" from re-spending Kie credits on clips the
  // operator has already rendered one-by-one, and naturally turns the CTA
  // into the next-phase advance once everything is rendered.
  const renderedIndexes = clips.filter((c) => !!c.storage_path).map((c) => c.index);
  const unrenderedIndexes = clips.filter((c) => !c.storage_path).map((c) => c.index);
  const allRendered = clips.length > 0 && unrenderedIndexes.length === 0;
  const someRendered = renderedIndexes.length > 0 && unrenderedIndexes.length > 0;
  const bottomLabel = allRendered
    ? 'Continue to clip review →'
    : someRendered
      ? `Generate ${unrenderedIndexes.length} remaining ${unrenderedIndexes.length === 1 ? 'clip' : 'clips'} →`
      : `Generate all ${clips.length} clips →`;

  async function handleBottomAction() {
    if (allRendered) {
      onAdvance();
      return;
    }
    setGenerating(true);
    try {
      // null when nothing rendered yet (Modal handles "all clips" internally);
      // explicit subset otherwise so we only spend on what's missing.
      const indexesToRender = someRendered ? unrenderedIndexes : null;
      await triggerClips(clipPlanId, indexesToRender, tier);
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
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <span>~${totalCostEstimateUsd.toFixed(2)} estimated at</span>
            <button
              type="button"
              onClick={() => setTierPickerOpen(true)}
              aria-label="Change render quality"
              style={{
                background: 'none',
                border: 'none',
                padding: '4px 8px',
                margin: 0,
                fontFamily: 'inherit',
                fontStyle: 'inherit',
                fontSize: 'inherit',
                color: 'var(--navy-700)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
                cursor: 'pointer',
                minHeight: 32,
                borderRadius: 4,
              }}
            >
              {tierLabel} ▸
            </button>
          </div>
        )}
      </div>

      {clips.map((c, i) => (
        <PlanClipCard
          key={c.id}
          clip={c}
          clipPlanId={clipPlanId}
          parshaSlug={parshaSlug}
          moves={moves}
          refImageLibrary={refImageLibrary}
          // Sequential gate: clip N's per-card generate is enabled only
          // when N-1 has a rendered mp4. Without this, an operator who
          // tapped 'Generate this clip' on clip 3 before clip 2 would
          // break scene-group chaining (clip 3's first_frame_url would
          // not be clip 2's last frame, giving Seedance a fresh roll of
          // the room and producing visual discontinuity at the cut).
          // Clip 0 has no predecessor, always enabled.
          prevRendered={i === 0 || !!clips[i - 1].storage_path}
          prevIndex={i === 0 ? null : i - 1}
          tier={tier}
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
        {/* Primary: filled navy. Label + behavior changes based on render
            state — generate-all, generate-remaining, or advance to Phase 3. */}
        <button
          type="button"
          onClick={handleBottomAction}
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
          {generating ? 'Starting…' : bottomLabel}
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

      <TierPickerSheet
        open={tierPickerOpen}
        onOpenChange={setTierPickerOpen}
        current={tier}
        totalDurationS={totalDurationS}
        onPick={setTier}
      />
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
  prevRendered: boolean; // true if the prior clip has an mp4 (or this is clip 0)
  prevIndex: number | null; // 0-based index of the prior clip, null on clip 0
  tier: TierChoice; // chosen render tier — passed into triggerClips
}

function PlanClipCard({ clip, clipPlanId, parshaSlug, moves, refImageLibrary, prevRendered, prevIndex, tier }: CardProps) {
  const router = useRouter();
  const [motionPickerOpen, setMotionPickerOpen] = useState(false);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [removeSheetOpen, setRemoveSheetOpen] = useState(false);
  const [sceneExpanded, setSceneExpanded] = useState(false);
  const [motionSlug, setMotionSlug] = useState<string | null>(clip.motion_ref_slug);
  const [refPaths, setRefPaths] = useState<string[]>(clip.reference_image_paths ?? []);
  const [chainBroken, setChainBroken] = useState<boolean>(clip.chain_broken);
  const [removing, setRemoving] = useState(false);
  const [breakingChain, setBreakingChain] = useState(false);
  // Per-clip render state. Cleared by ANY of:
  //   1. liveJob.status === 'done' (success — realtime + poll on the
  //      clips-only job we triggered). On done we also router.refresh()
  //      so the server re-fetches phase-2-data and the inline player
  //      picks up the new storage_path (the rendered clip lives in a
  //      separate row under the clips-only job_id; the realtime sub on
  //      plan-only's clip rows won't see it without a refresh).
  //   2. liveJob.status === 'failed' (Modal crashed, Kie rejected, etc.)
  //   3. clip.storage_path appears (defensive — first-time generation
  //      against a clean plan; rarely fires for re-renders since the
  //      plan-only row's storage_path stays null)
  // No hard timeout — both signals have defensive 10s polling now, so
  // a stuck spinner means the job is genuinely still running (or in the
  // rare case Modal never picked up the trigger, which the operator
  // can resolve by refreshing or tapping Generate again). Showing
  // elapsed time + a soft 'taking longer than usual' hint after 5 min
  // gives them the context without us pretending to know it failed.
  const [thisRendering, setThisRendering] = useState(false);
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  const [renderStartedAt, setRenderStartedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Watch the clips-only job we just triggered so we can detect failure
  // and surface it to the operator. The hook does an initial SELECT +
  // 10s defensive poll so we catch the failure even if postgres_changes
  // misses the UPDATE event.
  const liveJob = useRealtimeRow<{ id: string; status: string; error_message: string | null }>(
    'jobs',
    liveJobId,
    null,
  );

  // Success path — clip mp4 appeared in storage. Clears the spinner and
  // closes out the live job watch.
  useEffect(() => {
    if (clip.storage_path) {
      setThisRendering(false);
      setLiveJobId(null);
      setRenderStartedAt(null);
    }
  }, [clip.storage_path]);

  // Live elapsed-time tick — only runs while rendering, so we don't burn
  // setInterval cycles when nothing's in flight.
  useEffect(() => {
    if (!thisRendering) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [thisRendering]);

  // Terminal-state path — clips-only job ended in 'done' or 'failed'.
  // On 'done', router.refresh() so the server re-fetches phase-2-data
  // and the inline player overlay picks up the new storage_path. On
  // 'failed', surface a toast with the first line of error_message
  // and a 'View log' action linking to /jobs/[id] for the traceback.
  useEffect(() => {
    if (!liveJob) return;
    if (liveJob.status === 'done') {
      setThisRendering(false);
      setLiveJobId(null);
      setRenderStartedAt(null);
      router.refresh();
      return;
    }
    if (liveJob.status === 'failed') {
      setThisRendering(false);
      setLiveJobId(null);
      setRenderStartedAt(null);
      const detail = (liveJob.error_message ?? 'Job failed without an error message.')
        .split('\n')[0]
        .slice(0, 220);
      toast.error(`Clip ${clip.index + 1} render failed`, {
        description: detail,
        action: {
          label: 'View log',
          onClick: () => window.open(`/jobs/${liveJob.id}`, '_blank'),
        },
        duration: 12000,
      });
    }
  }, [liveJob, clip.index, router]);

  async function generateThisClip() {
    if (thisRendering) return;
    setThisRendering(true);
    setRenderStartedAt(Date.now());
    try {
      const { jobId } = await triggerClips(clipPlanId, [clip.index], tier);
      setLiveJobId(jobId);
    } catch (e) {
      setThisRendering(false);
      setLiveJobId(null);
      setRenderStartedAt(null);
      toast.error("Couldn't start clip generation.", {
        description: (e as Error).message,
      });
    }
  }

  // Elapsed time + 'taking longer than usual' hint, derived purely from
  // local state — no timer side effects, just maths on the tick.
  const elapsedSec = renderStartedAt ? Math.floor((nowMs - renderStartedAt) / 1000) : 0;
  const elapsedLabel = elapsedSec < 60
    ? `${elapsedSec}s`
    : `${Math.floor(elapsedSec / 60)}m ${String(elapsedSec % 60).padStart(2, '0')}s`;
  const elapsedHint = elapsedSec >= 5 * 60
    ? 'Taking longer than usual — Kie may be queued. Your render keeps going regardless; refresh anytime to check.'
    : null;

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

      {/* Inline mini-player + Re-render — visible once this clip has a
          rendered mp4. The editors above stay live; the operator edits
          voiceover / scene direction / move / refs in place, taps
          Re-render, watches the new version in the same player. The
          phase-2-data overlay always picks the most-recent rendered
          storage_path, so a re-render just swaps the mp4 url here. */}
      {clip.storage_path && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 240,
              aspectRatio: '9 / 16',
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--ink-900)',
              margin: '0 auto 12px',
            }}
          >
            {/* keyed on storage_path so a re-render forces the <video>
                element to remount and pick up the new src instead of
                continuing to show the prior mp4 in its buffer. */}
            <video
              key={clip.storage_path}
              src={publicVideoUrl(clip.storage_path)}
              controls
              playsInline
              preload="metadata"
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
                  Re-rendering… {elapsedLabel}
                </>
              ) : (
                <>↻ Re-render</>
              )}
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
          {thisRendering && elapsedHint && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11.5,
                color: 'var(--ink-500)',
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                lineHeight: 1.5,
                textAlign: 'right',
              }}
            >
              {elapsedHint}
            </div>
          )}
        </div>
      )}

      {/* First-generation button — outlined / secondary so it doesn't compete
          with the sticky bottom "Generate all". Only shown when no render
          exists yet. Gated by prevRendered: clip N's button is disabled
          until clip N-1 has a rendered mp4, so scene-group chaining (clip
          N's first frame = clip N-1's last frame) is never broken by
          out-of-order generation. */}
      {!clip.storage_path && (
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {!prevRendered && !thisRendering && (
            <span
              style={{
                fontSize: 11.5,
                color: 'var(--ink-500)',
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
              }}
            >
              Generate clip {prevIndex !== null ? prevIndex + 1 : ''} first
            </span>
          )}
          <button
            type="button"
            onClick={generateThisClip}
            disabled={thisRendering || !prevRendered}
            aria-busy={thisRendering}
            title={!prevRendered ? `Render clip ${prevIndex !== null ? prevIndex + 1 : ''} first to keep scene continuity` : undefined}
            style={{
              minHeight: 40,
              fontSize: 13,
              fontWeight: 500,
              padding: '8px 14px',
              borderRadius: 8,
              background: 'white',
              color: thisRendering || !prevRendered ? 'var(--ink-300)' : 'var(--navy-700)',
              border: `1px solid ${thisRendering || !prevRendered ? 'var(--ink-200)' : 'var(--navy-700)'}`,
              cursor: thisRendering ? 'wait' : !prevRendered ? 'not-allowed' : 'pointer',
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
                Rendering this clip… {elapsedLabel}
              </>
            ) : (
              <>▶ Generate this clip</>
            )}
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {thisRendering && elapsedHint && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11.5,
            color: 'var(--ink-500)',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            lineHeight: 1.5,
            textAlign: 'right',
          }}
        >
          {elapsedHint}
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
