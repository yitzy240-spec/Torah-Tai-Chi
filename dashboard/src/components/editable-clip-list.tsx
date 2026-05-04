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
}: Props) {
  const router = useRouter();
  const indices = Object.keys(clipsByIndex).map(Number).sort((a, b) => a - b);
  const totalClips = indices.length;

  const [selectedByIndex, setSelectedByIndex] = useState<Record<number, string>>(
    () => {
      const m: Record<number, string> = {};
      for (const idx of indices) {
        const versions = clipsByIndex[idx];
        m[idx] = versions[versions.length - 1].clipId;
      }
      return m;
    },
  );

  const [isComposing, startCompose] = useTransition();
  const [composeError, setComposeError] = useState<string | null>(null);

  // True if the user picked at least one non-latest version somewhere.
  // When everything is on latest, the compose would just re-stitch the
  // current latest video — pointless, so the button is disabled.
  const anyNonLatestSelected = indices.some((idx) => {
    const versions = clipsByIndex[idx];
    const latestId = versions[versions.length - 1].clipId;
    const sel = selectedByIndex[idx] ?? latestId;
    return sel !== latestId;
  });

  // Human-readable summary of the user's pick: "v2 of clip 2, latest of others".
  const pickSummary = indices
    .map((idx) => {
      const versions = clipsByIndex[idx];
      const sel = selectedByIndex[idx] ?? versions[versions.length - 1].clipId;
      const selIdx = versions.findIndex((v) => v.clipId === sel);
      const isLatest = selIdx === versions.length - 1;
      return isLatest ? null : `clip ${idx + 1} → v${selIdx + 1}`;
    })
    .filter(Boolean)
    .join(', ');

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
      } else if (result.status === 'timeout') {
        setComposeError(
          'Compose is still running after 20 minutes. Refresh the page to check on it.',
        );
      }
      router.refresh();
    });
  }

  const applyDisabled = !anyNonLatestSelected || isComposing;

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
          />
        );
      })}

      {/* Apply-selection bar — only really useful when at least one
          clip is on a non-latest version. We always render the bar so
          the user can see how the feature works, but the button is
          disabled when there's nothing to compose. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '18px 22px',
          marginTop: 8,
          marginBottom: 24,
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-100)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--ff-body)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--cedar-600)',
              marginBottom: 6,
            }}
          >
            Apply selection
          </div>
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: 13.5,
              color: 'var(--ink-700)',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
            }}
          >
            {anyNonLatestSelected
              ? `Stitch a new video using your picks: ${pickSummary}. Other clips use the latest version. ~30s, no Seedance cost (just a re-stitch).`
              : 'Pick a non-latest version on any clip above to stitch a custom combination here. Useful when a recent re-render turned out worse than a previous version.'}
          </div>
          {composeError && (
            <div
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: 12.5,
                color: 'var(--tassel)',
                marginTop: 8,
              }}
            >
              {composeError}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleApply}
          disabled={applyDisabled}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: 14,
            padding: '11px 22px',
            minHeight: 44,
            borderRadius: '999px',
            border: '1px solid var(--navy-800)',
            background: applyDisabled ? 'var(--ink-200)' : 'var(--navy-800)',
            color: 'var(--linen-50)',
            cursor: applyDisabled ? 'not-allowed' : 'pointer',
            opacity: applyDisabled ? 0.6 : 1,
          }}
        >
          {isComposing ? 'Stitching…' : 'Apply selection · stitch new video'}
        </button>
      </div>
    </>
  );
}
