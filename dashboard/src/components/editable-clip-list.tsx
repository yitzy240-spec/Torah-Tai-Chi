'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EditableClipCard, type EditableClipVersion } from './editable-clip-card';
import { composeVideo } from '@/app/actions/compose-video';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';

interface Props {
  videoId: string;
  clipsByIndex: Record<number, EditableClipVersion[]>;
  durationsByIndex: Record<number, number>;
  resolution: Resolution | null;
  modelTier: ModelTier | null;
  /** Any non-compose job for this parsha. composeVideo copies its
   *  generation params (motion_ref_slug, resolution, etc.) onto the new
   *  compose job. Latest done parent is the natural choice. */
  referenceJobId: string;
  /** When the displayed video is a compose, this is the ordered array
   *  of clip UUIDs that compose stitched together (videos.composed_from_clip_ids).
   *  We default the per-clip selection to these IDs so the inline
   *  preview videos + textareas + Re-render all hit the same clip
   *  the top-of-page composed video is showing — instead of defaulting
   *  to the latest-ever clip per index, which after a rollback can be
   *  a NEWER but UNUSED version. */
  composedFromClipIds?: string[] | null;
}

const TERMINAL_JOB_STATUSES = new Set(['done', 'failed']);

/** Same Realtime + polling pattern as EditableClipCard.waitForJobTerminal. */
function waitForJobTerminal(
  jobId: string,
  timeoutMs: number,
): Promise<{ status: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (status: string) => {
      if (resolved) return;
      resolved = true;
      try { void supabase.removeChannel(channel); } catch { /* noop */ }
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      resolve({ status });
    };

    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`compose-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const status = (payload.new as { status?: string } | null)?.status;
          if (status && TERMINAL_JOB_STATUSES.has(status)) finish(status);
        },
      )
      .subscribe();

    const pollTimer = setInterval(async () => {
      if (resolved) return;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status && TERMINAL_JOB_STATUSES.has(data.status)) finish(data.status);
      } catch {
        // transient — keep waiting
      }
    }, 8000);

    const timeoutTimer = setTimeout(() => finish('timeout'), timeoutMs);
  });
}

/**
 * Thin client wrapper around the per-index <EditableClipCard> list. Server
 * components can't pass closures across the RSC boundary, so we own the
 * `selectedByIndex` state here and forward an `onSelectVersion` callback
 * into each card. State defaults to the latest version of each clip.
 *
 * When the user selects any non-latest clip version, an "Apply selection"
 * bar appears beneath the list with a button that triggers compose: stitch
 * the chosen mp4s into a new final video for this parsha. Useful for
 * rolling back individual clip regens that turned out worse than the prior
 * version.
 */
export function EditableClipList({
  videoId,
  clipsByIndex,
  durationsByIndex,
  resolution,
  modelTier,
  referenceJobId,
  composedFromClipIds,
}: Props) {
  const router = useRouter();
  const indices = Object.keys(clipsByIndex).map(Number).sort((a, b) => a - b);
  const totalClips = indices.length;

  // Default selection per index:
  //  - If the displayed video is composed (composedFromClipIds is set),
  //    use the clip the compose stitched at this slot. Keeps the per-
  //    clip preview + edit textarea + re-render all aligned with what
  //    the top-of-page video actually shows.
  //  - Otherwise, use the latest version per index (legacy behavior).
  const [selectedByIndex, setSelectedByIndex] = useState<Record<number, string>>(
    () => {
      const m: Record<number, string> = {};
      for (const idx of indices) {
        const versions = clipsByIndex[idx];
        const composedAtSlot =
          composedFromClipIds && composedFromClipIds.length > idx
            ? composedFromClipIds[idx]
            : null;
        const matchesComposed =
          composedAtSlot
            ? versions.some((v) => v.clipId === composedAtSlot)
            : false;
        m[idx] = matchesComposed
          ? composedAtSlot!
          : versions[versions.length - 1].clipId;
      }
      return m;
    },
  );

  const [isComposing, startCompose] = useTransition();
  const [composeError, setComposeError] = useState<string | null>(null);

  function handleApply() {
    setComposeError(null);
    startCompose(async () => {
      // Build clipIds in slot order: 0, 1, 2, ...
      const clipIds = indices.map(
        (idx) => selectedByIndex[idx] ?? clipsByIndex[idx][clipsByIndex[idx].length - 1].clipId,
      );
      const r = await composeVideo({ referenceJobId, clipIds });
      if ('error' in r) {
        setComposeError(r.error);
        return;
      }
      // Wait for the compose job to finish before refreshing — same
      // 20-min cap as EditableClipCard.handleReRender.
      const result = await waitForJobTerminal(r.jobId, 20 * 60 * 1000);
      if (result.status === 'failed') {
        setComposeError('Compose failed. Open the parsha page logs for details.');
        return;
      }
      if (result.status === 'timeout') {
        setComposeError(
          'Compose is still running after 20 minutes. Refresh the page to check on it.',
        );
        return;
      }
      // Success: reset selections to latest. After router.refresh the
      // versions arrays will include the new composed clips, and the
      // user's "I picked v2 of clip 2" is now consumed — defaulting
      // back to all-latest is the cleanest mental model.
      const reset: Record<number, string> = {};
      for (const idx of indices) {
        const vs = clipsByIndex[idx];
        reset[idx] = vs[vs.length - 1].clipId;
      }
      setSelectedByIndex(reset);
      router.refresh();
    });
  }

  return (
    <>
      {indices.map((idx) => {
        const versions = clipsByIndex[idx];
        return (
          <EditableClipCard
            key={`clip-${idx}`}
            videoId={videoId}
            index={idx}
            totalClips={totalClips}
            durationS={durationsByIndex[idx] ?? 0}
            versions={versions}
            selectedClipId={selectedByIndex[idx] ?? versions[versions.length - 1].clipId}
            onSelectVersion={(clipId) =>
              setSelectedByIndex((prev) => ({ ...prev, [idx]: clipId }))
            }
            resolution={resolution}
            modelTier={modelTier}
            onApply={handleApply}
            applying={isComposing}
          />
        );
      })}

      {/* Compose error surfaced once for the whole list — the per-card
          buttons all share one in-flight compose, so a single error
          banner here is the right placement. Only renders when there's
          an error to show. */}
      {composeError && (
        <div
          role="alert"
          style={{
            padding: '14px 18px',
            marginBottom: 24,
            border: '1px solid var(--tassel)',
            borderRadius: 'var(--r-md)',
            background: 'rgba(192,57,43,.06)',
            fontFamily: 'var(--ff-body)',
            fontSize: 13,
            color: 'var(--tassel)',
          }}
        >
          {composeError}
        </div>
      )}
    </>
  );
}
