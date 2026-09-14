// dashboard/src/lib/clip-duration.ts
//
// Single source of truth for clip duration bounds.
//
// Kie's Seedance createTask accepts an INTEGER 4-15 seconds (verified
// against docs.kie.ai/market/bytedance/seedance-2 on 2026-09-14; default
// 5). Anything outside that returns 422 "Invalid duration" — after the
// operator has waited on a spinner.
//
// Before this module the floor was defined in three places with three
// different values: the Phase 2 UI clamped to 3, update-clip-text
// accepted 1, and only src/models.py (Python) had the correct 4. Yonah
// set a clip to 3s on Ha'azinu (2026-09-13) — the UI accepted it, Kie
// rejected it, and his evening was spent on a failure the dashboard
// could have prevented. Import from here; do not redeclare.

export const CLIP_DURATION_MIN_S = 4;
export const CLIP_DURATION_MAX_S = 15;

/** Clamp to Kie's accepted range and force an integer (Kie rejects floats). */
export function clampClipDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return CLIP_DURATION_MIN_S;
  return Math.max(
    CLIP_DURATION_MIN_S,
    Math.min(CLIP_DURATION_MAX_S, Math.round(seconds)),
  );
}

/** True when a value is a duration Kie will accept as-is. */
export function isValidClipDuration(seconds: number): boolean {
  return (
    Number.isInteger(seconds) &&
    seconds >= CLIP_DURATION_MIN_S &&
    seconds <= CLIP_DURATION_MAX_S
  );
}
