// dashboard/src/app/videos/[slug]/_data/phase-3-data.ts
//
// Data preparation for Phase 3 (Clips).
// Fetches clip rows + Tai Chi moves in parallel.

import { createClient } from '@/lib/supabase/server';
import { listTaiChiMoves } from '@/lib/tai-chi-moves';
import type { TaiChiMove } from '@/lib/tai-chi-moves';

export type Phase3Clip = {
  id: string;
  index: number;
  storage_path: string | null;
  duration_s: number | null;
  voiceover: string;
  visual_prompt: string;
  motion_ref_slug: string | null;
  created_at: string;
};

export type Phase3Props = {
  videoId: string;
  jobId: string;
  parshaSlug: string;
  initialClips: Phase3Clip[];
  moves: TaiChiMove[];
};

export async function getPhase3Props(
  parshaSlug: string,
  draftJobId: string,
  draftVideoId: string,
): Promise<Phase3Props> {
  const supabase = await createClient();

  // Parallelize: clips + moves — independent
  const [clipsResult, moves] = await Promise.all([
    supabase
      .from('clips')
      .select('id, index, storage_path, duration_s, voiceover, visual_prompt, motion_ref_slug, created_at')
      .eq('job_id', draftJobId)
      .order('index'),
    listTaiChiMoves(),
  ]);

  const initialClips: Phase3Clip[] = (clipsResult.data ?? []).map((c) => ({
    id: c.id as string,
    index: c.index as number,
    storage_path: (c.storage_path as string | null) ?? null,
    duration_s: (c.duration_s as number | null) ?? null,
    voiceover: (c.voiceover as string | null) ?? '',
    visual_prompt: (c.visual_prompt as string | null) ?? '',
    motion_ref_slug: (c.motion_ref_slug as string | null) ?? null,
    created_at: (c.created_at as string | null) ?? new Date(0).toISOString(),
  }));

  return {
    videoId: draftVideoId,
    jobId: draftJobId,
    parshaSlug,
    initialClips,
    moves,
  };
}
