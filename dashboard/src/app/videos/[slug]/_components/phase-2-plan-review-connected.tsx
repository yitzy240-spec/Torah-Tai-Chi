// dashboard/src/app/videos/[slug]/_components/phase-2-plan-review-connected.tsx
//
// Thin client wrapper that supplies the onAdvance / onBack callbacks to
// Phase2PlanReview. In Milestone 4 these will be replaced with a real
// phase-state machine (URL or cookie driven). For now advancing or going
// back triggers window.location.reload() so the server re-evaluates page
// state (phase 3 becomes visible once a clips-only job is queued).

'use client';
import type { TaiChiMove } from '@/lib/tai-chi-moves';
import type { RefImage } from './_shared/reference-image-picker-sheet';
import { Phase2PlanReview } from './phase-2-plan-review';

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
  jobId: string;
  clipPlanId: string;
  initialClips: Clip[];
  totalCostEstimateUsd: number | null;
  tierLabel: string;
  moves: TaiChiMove[];
  refImageLibrary: RefImage[];
}

export function Phase2PlanReviewConnected(props: Props) {
  function handleAdvance() {
    // Phase 3 navigation — full impl in M4. Reload so server detects
    // the new clips-only job and renders the phase 3 stub.
    window.location.reload();
  }

  function handleBack() {
    // Back to Phase 1 — full impl in M4.
    window.location.reload();
  }

  return (
    <Phase2PlanReview
      {...props}
      refImageLibrary={props.refImageLibrary}
      onAdvance={handleAdvance}
      onBack={handleBack}
    />
  );
}
