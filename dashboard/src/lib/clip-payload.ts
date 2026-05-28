// dashboard/src/lib/clip-payload.ts
//
// Shared helper to build a VTT captions data URL + clip boundary list
// from a clip plan JSON + clip rows. Consumed by Phase 4's stitched-
// video player to align caption cues with clip start/end times.
//
// NOTE: runs in Node (server components / server actions) because it
// uses `Buffer.from(...)` for base64 encoding. Do NOT mark 'use client'.

export interface ClipBoundary {
  id: string;
  startS: number;
  endS: number;
  voiceover: string;
}

export interface ClipPayloadResult {
  captionsVttDataUrl: string | null;
  /** Clip boundary list for scrub markers + feedback UI */
  clips: ClipBoundary[];
  totalDurationS: number;
  /** Cumulative start offsets for each clip (suitable for scrub-marker positions) */
  clipBoundariesS: number[];
}

function fmtVttTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
}

/**
 * Build a captions VTT data URL + clip boundaries from a job's clip plan.
 *
 * @param planJson  The raw value stored in `clip_plans.plan_json`. May be
 *                  null/undefined for plan-only jobs that haven't been run yet.
 * @param clipRows  The `clips` rows for this job (id + index required). Used to
 *                  map plan clip indexes → clip row IDs.
 */
export function buildClipPayload(
  planJson: unknown,
  clipRows: Array<{ id: string; index: number }>,
): ClipPayloadResult {
  const plan = (planJson ?? {}) as {
    clips?: Array<{ voiceover?: string; duration_s?: number; index?: number }>;
  };

  if (!Array.isArray(plan.clips) || plan.clips.length === 0) {
    return { captionsVttDataUrl: null, clips: [], totalDurationS: 0, clipBoundariesS: [] };
  }

  const ordered = [...plan.clips].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  // Build VTT cues
  let cur = 0;
  const cues: string[] = [];
  for (const c of ordered) {
    const dur = c.duration_s ?? 0;
    const text = (c.voiceover ?? '').trim();
    if (dur > 0 && text) cues.push(`${fmtVttTime(cur)} --> ${fmtVttTime(cur + dur)}\n${text}`);
    cur += dur;
  }

  const captionsVttDataUrl =
    cues.length > 0
      ? `data:text/vtt;charset=utf-8;base64,${Buffer.from('WEBVTT\n\n' + cues.join('\n\n') + '\n', 'utf-8').toString('base64')}`
      : null;

  // Build clip boundaries
  const idByIndex = new Map<number, string>(clipRows.map((r) => [r.index, r.id]));
  const clips: ClipBoundary[] = [];
  const clipBoundariesS: number[] = [];
  let cursorS = 0;

  for (const c of ordered) {
    const dur = c.duration_s ?? 0;
    const idx = c.index ?? 0;
    const id = idByIndex.get(idx);
    const start = cursorS;
    clipBoundariesS.push(start);
    cursorS += dur;
    if (!id) continue;
    clips.push({
      id,
      voiceover: (c.voiceover ?? '').trim(),
      startS: start,
      endS: cursorS,
    });
  }

  return { captionsVttDataUrl, clips, totalDurationS: cursorS, clipBoundariesS };
}
