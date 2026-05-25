'use client';

import { useState } from 'react';
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
  /** Per-index canonical clipId of the version currently visible in
   *  the top-of-page video. Used as the DEFAULT selected version on
   *  every clip card so changing one clip's pick (and hitting Apply)
   *  doesn't silently pull in newer versions of the OTHER clips that
   *  weren't part of the displayed video. Without this, a re-render
   *  of clip 1 that happened AFTER a compose would silently replace
   *  the user's prior compose work the next time they hit Apply on a
   *  different clip. */
  displayedClipIdByIndex: Record<number, string>;
}

const TERMINAL_JOB_STATUSES = new Set(['done', 'failed']);

/** Same Realtime + polling pattern as EditableClipCard.waitForJobTerminal. */
function waitForJobTerminal(
  jobId: string,
  timeoutMs: number,
): Promise<{ status: string; errorMessage: string | null }> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = async (status: string) => {
      if (resolved) return;
      resolved = true;
      try { void supabase.removeChannel(channel); } catch { /* noop */ }
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      let errorMessage: string | null = null;
      if (status === 'failed') {
        try {
          const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
          if (res.ok) {
            const data = (await res.json()) as { errorMessage?: string | null };
            errorMessage = data.errorMessage ?? null;
          }
        } catch { /* best-effort */ }
      }
      resolve({ status, errorMessage });
    };

    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`compose-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const status = (payload.new as { status?: string } | null)?.status;
          if (status && TERMINAL_JOB_STATUSES.has(status)) void finish(status);
        },
      )
      .subscribe();

    const pollTimer = setInterval(async () => {
      if (resolved) return;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (data.status && TERMINAL_JOB_STATUSES.has(data.status)) void finish(data.status);
      } catch {
        // transient — keep waiting
      }
    }, 8000);

    const timeoutTimer = setTimeout(() => void finish('timeout'), timeoutMs);
  });
}

/** Mirror of friendlyRenderError in editable-clip-card.tsx — kept inline
 *  rather than imported because that file is a client component and the
 *  helper isn't large enough to warrant a shared util. */
function friendlyComposeError(raw: string | null): string {
  if (!raw) return 'Compose failed. Open the parsha page logs for details.';
  const lower = raw.toLowerCase();
  if (
    lower.includes('credit') &&
    (lower.includes('exhaust') || lower.includes('insufficient') || lower.includes('not enough'))
  ) {
    return 'Out of Kie credits. Top up at kie.ai/billing, then try again.';
  }
  if (lower.includes('quota')) {
    return 'Kie quota hit. Wait a few minutes or top up at kie.ai/billing, then try again.';
  }
  const firstLine = raw.split('\n')[0]?.trim() ?? raw;
  return `Compose failed: ${firstLine.slice(0, 220)}`;
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
  displayedClipIdByIndex,
}: Props) {
  const router = useRouter();
  const indices = Object.keys(clipsByIndex).map(Number).sort((a, b) => a - b);
  const totalClips = indices.length;

  // Default each clip's selection to the version visible in the top-
  // of-page video (composed or not). Falls back to latest only when
  // the displayed-video map doesn't cover this index — should be rare
  // and indicates a parsha with mismatched data, not a normal flow.
  const [selectedByIndex, setSelectedByIndex] = useState<Record<number, string>>(
    () => {
      const m: Record<number, string> = {};
      for (const idx of indices) {
        const versions = clipsByIndex[idx];
        const displayedClipId = displayedClipIdByIndex[idx];
        const matches = displayedClipId
          ? versions.some((v) => v.clipId === displayedClipId)
          : false;
        m[idx] = matches
          ? displayedClipId
          : versions[versions.length - 1].clipId;
      }
      return m;
    },
  );

  // Plain state instead of useTransition — the 20-min compose wait
  // would otherwise queue navigation transitions behind it (Next.js
  // App Router treats Link clicks as transitions). See the matching
  // comment in editable-clip-card.tsx.
  const [isComposing, setIsComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  function handleApply() {
    setComposeError(null);
    setIsComposing(true);
    (async () => {
      try {
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
          setComposeError(friendlyComposeError(result.errorMessage));
          return;
        }
        if (result.status === 'timeout') {
          setComposeError(
            'Compose is still running after 20 minutes. Refresh the page to check on it.',
          );
          return;
        }
        // Success: reset selections to latest. After router.refresh
        // the versions arrays will include the new composed clips, and
        // the user's "I picked v2 of clip 2" is now consumed —
        // defaulting back to all-latest is the cleanest mental model.
        const reset: Record<number, string> = {};
        for (const idx of indices) {
          const vs = clipsByIndex[idx];
          reset[idx] = vs[vs.length - 1].clipId;
        }
        setSelectedByIndex(reset);
        router.refresh();
      } finally {
        setIsComposing(false);
      }
    })();
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
            displayedClipId={
              // The clip_id the currently-displayed video uses at this slot.
              // Falls back to latest only when the displayed-video map doesn't
              // cover this index (rare: parsha with mismatched data). Used to
              // surface the Apply button when the user picks something
              // different from what the stitched video already uses.
              displayedClipIdByIndex[idx]
              ?? versions[versions.length - 1].clipId
            }
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
