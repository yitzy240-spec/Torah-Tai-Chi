// dashboard/src/lib/dedupe-clips.ts
//
// Canonical clip dedupe-by-storage-path helper.
//
// Every regen (and every full pipeline run) inserts a fresh clip row for
// EVERY index. The index that was actually re-rendered gets a new mp4 path;
// unchanged indices get rows that copy the parent's mp4 path verbatim.
// Without dedupe a 7-job parsha showed 7 version chips per clip even though
// most clips only had 2–3 distinct renders.
//
// Rule: keep the FIRST (oldest by created_at) row for each distinct
// storage_path within each index so that version chips reflect actual content
// changes, not regen side-effects. Input clips must already be sorted
// ascending by created_at (or this function sorts them).

export interface RawClip {
  id: string;
  index: number;
  storage_path: string | null;
  created_at: string;
}

/**
 * Dedupes a flat list of clip rows by storage_path within each clip index.
 *
 * Returns a Record keyed by index. Each value is an array of the unique
 * clips for that index, ordered oldest-to-newest (oldest distinct path
 * wins, matching legacy behavior). Clips without a storage_path (not yet
 * rendered) are excluded from the dedupe output.
 *
 * The generic parameter T allows callers to pass richer clip shapes and get
 * them back typed correctly.
 */
export function dedupeClipsByStoragePath<T extends RawClip>(
  clips: T[],
): Record<number, T[]> {
  // Sort ascending by created_at so the first (oldest) occurrence of a
  // storage_path wins. Create a copy to avoid mutating the caller's array.
  const sorted = [...clips].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const seenPathPerIndex: Record<number, Set<string>> = {};
  const result: Record<number, T[]> = {};

  for (const c of sorted) {
    const path = c.storage_path;
    if (!path) continue; // skip clips without a checkpointed mp4

    const idx = c.index;
    if (!seenPathPerIndex[idx]) seenPathPerIndex[idx] = new Set();
    if (seenPathPerIndex[idx].has(path)) continue;
    seenPathPerIndex[idx].add(path);

    if (!result[idx]) result[idx] = [];
    result[idx].push(c);
  }

  return result;
}
