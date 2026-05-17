// dashboard/src/app/videos/[slug]/_components/phase-3-clips-connected.tsx
//
// Thin client wrapper that supplies onAdvance / onBack to Phase3Clips.
// Same pattern as phase-2-plan-review-connected.tsx: page nav via
// window.location.reload() so the server re-evaluates page state.
// Full URL-based phase routing deferred to a future milestone.

'use client';
import type { TaiChiMove } from '@/lib/tai-chi-moves';
import { Phase3Clips } from './phase-3-clips';

interface ClipRow {
  id: string;
  index: number;
  storage_path: string | null;
  duration_s: number | null;
  voiceover: string;
  visual_prompt: string;
  motion_ref_slug: string | null;
  created_at: string;
}

interface Props {
  videoId: string;
  jobId: string;
  parshaSlug: string;
  initialClips: ClipRow[];
  moves: TaiChiMove[];
}

export function Phase3ClipsConnected(props: Props) {
  function handleAdvance() {
    // Phase 4 navigation — reload so server detects stitched video row
    window.location.reload();
  }

  function handleBack() {
    // Back to Phase 2
    window.location.reload();
  }

  return (
    <Phase3Clips
      {...props}
      onAdvance={handleAdvance}
      onBack={handleBack}
    />
  );
}
