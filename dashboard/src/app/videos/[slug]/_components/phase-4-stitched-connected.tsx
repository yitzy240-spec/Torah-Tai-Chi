// dashboard/src/app/videos/[slug]/_components/phase-4-stitched-connected.tsx
//
// Thin client wrapper supplying onAdvance / onBack to Phase4Stitched.

'use client';
import { useRouter } from 'next/navigation';
import { Phase4Stitched } from './phase-4-stitched';

interface Props {
  parshaSlug: string;
  videoId: string;
  videoMp4Path: string | null;
  thumbPath: string | null;
  composeJobId: string | null;
  captionsVttDataUrl: string | null;
  clipBoundariesS: number[];
  totalDurationS: number;
}

export function Phase4StitchedConnected({ parshaSlug, ...rest }: Props) {
  const router = useRouter();

  function handleAdvance() {
    router.push(`/videos/${parshaSlug}?phase=5`);
    router.refresh();
  }

  function handleBack() {
    // Phase 3 used to be a slimmer post-stitch iteration surface
    // (motion picker + version flip + re-render only). Operators
    // expect the SAME editor they used pre-stitch (voiceover, scene
    // direction, refs, motion, versions) — splitting them into two
    // surfaces wasn't serving a real workflow (Yonah 2026-06-01).
    // "Back to clips" now lands on Phase 2, the full editor.
    router.push(`/videos/${parshaSlug}?phase=2`);
    router.refresh();
  }

  return (
    <Phase4Stitched
      {...rest}
      onAdvance={handleAdvance}
      onBack={handleBack}
    />
  );
}
