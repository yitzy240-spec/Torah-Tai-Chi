// dashboard/src/app/videos/[slug]/_components/phase-2-plan-review-connected.tsx
//
// Thin client wrapper that supplies the onAdvance / onBack callbacks to
// Phase2PlanReview. Uses ?phase=N URL params so navigation actually
// moves the user; bare reload kept them stuck on the natural state
// phase derived from the data.

'use client';
import { useRouter } from 'next/navigation';
import type { TaiChiMove } from '@/lib/tai-chi-moves';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';
import type { RefImage } from './_shared/reference-image-picker-sheet';
import type { ClipVersion } from '../_data/phase-2-data';
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
  initialVersionsByIndex: Record<number, ClipVersion[]>;
  initialResolution: Resolution;
  initialModelTier: ModelTier;
  moves: TaiChiMove[];
  refImageLibrary: RefImage[];
}

export function Phase2PlanReviewConnected(props: Props) {
  const router = useRouter();

  // Phase 2 ALWAYS advances to Phase 4 (the stitched-video viewer).
  // When all clips are rendered, Phase 2's bottom CTA fires composeVideo
  // first, then calls this to navigate; the new compose job is freshly
  // queued and Phase 4's realtime sub picks up the mp4_path when Modal
  // finishes. Phase 3 (post-stitch per-clip iteration) is reachable from
  // Phase 4 via 'Back to clips' for operators who want to keep iterating.
  function handleAdvance() {
    router.push(`/videos/${props.parshaSlug}?phase=4`);
  }

  function handleBack() {
    router.push(`/videos/${props.parshaSlug}?phase=1`);
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
