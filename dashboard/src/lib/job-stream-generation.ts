// dashboard/src/lib/job-stream-generation.ts
//
// useJobStream keeps the last Broadcast event and drops the channel once it
// sees a terminal stage. A re-stitch re-runs the SAME compose job, so without
// a reset the Phase 4 player (a) read the previous stitch's stale 'done' the
// moment the operator hit re-stitch (spinner cleared instantly, old file
// reloaded) and (b) never heard the re-stitch's own events because the
// channel was already gone. Yonah 2026-11-24: "it didn't show up on my PC".
//
// Each event is tagged with the subscription generation it arrived on; a
// caller that bumps the generation (re-stitch start) sees null immediately,
// in the same render, and the hook re-subscribes.

export interface GenerationTagged<E> {
  generation: number;
  event: E | null;
}

export function eventForGeneration<E>(
  state: GenerationTagged<E>,
  generation: number,
): E | null {
  return state.generation === generation ? state.event : null;
}
