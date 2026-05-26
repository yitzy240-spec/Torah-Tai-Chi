// dashboard/src/app/videos/[slug]/_components/phase-3-clips-connected.tsx
//
// Thin client wrapper that supplies onAdvance / onBack to Phase3Clips.
// Uses ?phase=N URL params so navigation actually moves the user; bare
// router.refresh / reload kept them stuck on the natural state phase.
//
// On advance, re-stitches the composed video from the operator's
// per-clip version selections (set by Phase 2 chips, persisted in
// localStorage) so Phase 4 reflects any Phase 3 regens.

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { composeVideo } from '@/app/actions/compose-video';
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
  const [advancing, setAdvancing] = useState(false);

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    try {
      // Read operator's per-clip version selection from localStorage
      // (set by Phase 2 chips, persisted across navigations). Fall back
      // to the latest rendered clip per index if no manual pick.
      const clipIds: string[] = [];
      for (const c of props.initialClips) {
        const key = `plan.${props.parshaSlug}.${c.id}.selected_clip_id`;
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
        if (stored) {
          clipIds.push(stored);
        } else {
          // No selection — Phase 3 was entered without going through Phase 2's
          // versioning. Skip the compose trigger and let Phase 4 keep showing
          // whatever stitched video already exists.
          clipIds.length = 0;
          break;
        }
      }

      if (clipIds.length === props.initialClips.length) {
        const result = await composeVideo({
          referenceJobId: props.jobId,
          clipIds,
        });
        if ('error' in result) {
          toast.error("Couldn't start stitching.", { description: result.error });
          return;
        }
      }

      router.push(`/videos/${props.parshaSlug}?phase=4`);
      router.refresh();
    } finally {
      setAdvancing(false);
    }
  }

  function handleBack() {
    router.push(`/videos/${props.parshaSlug}?phase=2`);
  }

  return (
    <Phase3Clips
      {...props}
      onAdvance={handleAdvance}
      onBack={handleBack}
      advancing={advancing}
    />
  );
}
