// dashboard/src/app/videos/[slug]/_components/phase-3-clips-connected.tsx
//
// Thin client wrapper that supplies onAdvance / onBack to Phase3Clips.
// Uses ?phase=N URL params so navigation actually moves the user; bare
// router.refresh / reload kept them stuck on the natural state phase.

'use client';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();

  function handleAdvance() {
    router.push(`/videos/${props.parshaSlug}?phase=4`);
  }

  function handleBack() {
    router.push(`/videos/${props.parshaSlug}?phase=2`);
  }

  return (
    <Phase3Clips
      {...props}
      onAdvance={handleAdvance}
      onBack={handleBack}
    />
  );
}
