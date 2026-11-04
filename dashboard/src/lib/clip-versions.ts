// dashboard/src/lib/clip-versions.ts
//
// Builds Phase 2's per-index version list from rendered clip rows.
//
// Each version carries the scene direction from ITS OWN clips row — the
// visual_prompt Modal stored when it rendered that mp4 (kie_task_persist
// build_*_clip_row). The plan-only row's visual_prompt is the editable,
// latest direction; showing it next to an older version's chip made v1 look
// like it was rendered from today's wording. Kept pure (no Supabase import)
// so it runs under node:test.

/** One rendered version of a clip index — every render under a child
 *  job (clips-only from Phase 2, or regen-from-text from Phase 3)
 *  produces a new ClipVersion. Operator picks among them via the
 *  version chips on the Phase 2 card. */
export type ClipVersion = {
  clipId: string;
  /** The child job that produced this version. Lets a clip card tell
   *  ITS OWN render's output apart from any other version change, so the
   *  spinner clears only when this card's job actually landed a clip
   *  (not on an unrelated refetch mid-stitch — the double-render bug). */
  jobId: string;
  storagePath: string;
  createdAt: string;
  resolution: string | null;
  modelTier: string | null;
  /** The scene direction this version was rendered from, read from this
   *  version's own clips row. Null when the row has none. Never the
   *  plan's latest direction. */
  visualPrompt: string | null;
};

export interface RenderedClipRow {
  id: string;
  index: number;
  storage_path: string;
  created_at: string;
  job_id: string;
  visual_prompt: string | null;
}

export type JobTier = { resolution: string | null; modelTier: string | null };

/** The chip number for a version: v1 = oldest. `versions` is newest-first.
 *  Returns null when the clip id isn't one of the versions. */
export function versionNumberOf(versions: ClipVersion[], clipId: string): number | null {
  const i = versions.findIndex((v) => v.clipId === clipId);
  return i === -1 ? null : versions.length - i;
}

/** Group rendered rows by clip index, preserving input order (callers pass
 *  rows newest-first, so versions[0] is the newest render). */
export function buildVersionsByIndex(
  rows: RenderedClipRow[],
  tierByJobId: Map<string, JobTier>,
): Map<number, ClipVersion[]> {
  const versionsByIndex = new Map<number, ClipVersion[]>();
  for (const r of rows) {
    const tier = tierByJobId.get(r.job_id);
    const list = versionsByIndex.get(r.index) ?? [];
    list.push({
      clipId: r.id,
      jobId: r.job_id,
      storagePath: r.storage_path,
      createdAt: r.created_at,
      resolution: tier?.resolution ?? null,
      modelTier: tier?.modelTier ?? null,
      visualPrompt: r.visual_prompt?.trim() ? r.visual_prompt : null,
    });
    versionsByIndex.set(r.index, list);
  }
  return versionsByIndex;
}
