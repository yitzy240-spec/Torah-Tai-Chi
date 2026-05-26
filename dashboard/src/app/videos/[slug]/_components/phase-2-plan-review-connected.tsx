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

  function handleAdvance() {
    router.push(`/videos/${props.parshaSlug}?phase=3`);
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
