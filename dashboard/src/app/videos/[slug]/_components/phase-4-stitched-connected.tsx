// dashboard/src/app/videos/[slug]/_components/phase-4-stitched-connected.tsx
//
// Thin client wrapper supplying onAdvance / onBack to Phase4Stitched.

'use client';
import { Phase4Stitched } from './phase-4-stitched';

interface Props {
  videoMp4Path: string | null;
  thumbPath: string | null;
  captionsVttDataUrl: string | null;
  clipBoundariesS: number[];
  totalDurationS: number;
}

export function Phase4StitchedConnected(props: Props) {
  function handleAdvance() {
    // Phase 5 navigation — reload so server detects state update.
    window.location.reload();
  }

  function handleBack() {
    // Back to Phase 3 clips.
    window.location.reload();
  }

  return (
    <Phase4Stitched
      {...props}
      onAdvance={handleAdvance}
      onBack={handleBack}
    />
  );
}
