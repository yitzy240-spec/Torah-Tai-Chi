// dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx
//
// Phase 2: Plan review. Per-clip cards with voiceover + scene direction
// text editing, a Tai Chi move picker, and per-card "Generate this clip"
// (outlined / secondary). Sticky bottom "Generate all N clips →" (filled
// primary). Realtime subscription on clips via useRealtimeRows.
//
// CTA hierarchy per spec §4 Phase 2 UX review fix:
//   - Per-card "Generate this clip" → OUTLINED secondary (not filled)
//   - Sticky "Generate all N clips →" → FILLED primary navy
//
// Per spec §4 Phase 2 + §6.5. Mockup: 03-five-phase-flow-v2.html.

'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useLocalStorageDraft } from '@/hooks/use-localstorage-draft';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';
import { analyzeClip } from '@/lib/word-count';
import type { TaiChiMove } from '@/lib/tai-chi-moves';
import { savePlanClip } from '@/app/actions/video-page/save-plan-clip';
import { savePlanClipMotion } from '@/app/actions/video-page/save-plan-clip-motion';
import { triggerClips } from '@/app/actions/video-page/trigger-clips';
import { MotionPickerSheet } from './_shared/motion-picker-sheet';

interface Clip {
  id: string;
  index: number;
  voiceover: string;
  visual_prompt: string;
  duration_s: number | null;
  storage_path: string | null;
  motion_ref_slug: string | null;
}

interface Props {
  parshaSlug: string;
  jobId: string; // the plan-only job — used to subscribe to clip updates
  clipPlanId: string;
  initialClips: Clip[]; // sorted by index
  totalCostEstimateUsd: number | null;
  tierLabel: string; // e.g. "720p Fast"
  moves: TaiChiMove[]; // server-fetched library, passed in from page-new
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
}

function PlanClipCard({ clip, clipPlanId, parshaSlug, moves }: CardProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [motionSlug, setMotionSlug] = useState<string | null>(clip.motion_ref_slug);
  const [generatingThis, setGeneratingThis] = useState(false);

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

  const fb = analyzeClip(voTxt, clip.duration_s ?? 0);
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

  return (
    <div
      style={{
        border: '1px solid var(--ink-100)',
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
        background: 'var(--linen-50)',
      }}
    >
      {/* Card header: clip label + per-card generate button (OUTLINED secondary) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--ink-500)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          Clip {clip.index + 1}
          {clip.duration_s ? ` · ${clip.duration_s}s` : ''}
        </span>
        {/* Secondary outlined button — never filled (CTA hierarchy fix) */}
        <button
          type="button"
          onClick={generateThis}
          disabled={generatingThis}
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
      </div>

      {/* Voiceover */}
      <label
        style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 3 }}
      >
        Voiceover
      </label>
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
        {clip.duration_s ? ` · ${fb.wps.toFixed(1)} wps` : ''}
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
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
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
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        moves={moves}
        currentSlug={motionSlug}
        onPick={pickMotion}
      />
    </div>
  );
}
