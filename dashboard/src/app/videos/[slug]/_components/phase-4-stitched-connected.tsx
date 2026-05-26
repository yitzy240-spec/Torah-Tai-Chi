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
  captionsVttDataUrl: string | null;
  clipBoundariesS: number[];
  totalDurationS: number;
}

export function Phase4StitchedConnected({ parshaSlug, ...rest }: Props) {
  const router = useRouter();

  function handleAdvance() {
    router.push(`/videos/${parshaSlug}?phase=5`);
  }

  function handleBack() {
    router.push(`/videos/${parshaSlug}?phase=3`);
  }

  return (
    <Phase4Stitched
      {...rest}
      onAdvance={handleAdvance}
      onBack={handleBack}
    />
  );
}
