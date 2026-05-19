// dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx
//
// Phase 3: Clips. Per-clip cards with inline 9:16 mini-player,
// version picker (dedupe by storage_path per index), motion picker
// (spec §6.5), and per-card "Re-render" which calls the EXISTING
// regenClipFromText server action — NOT triggerClips (per EXECUTION-NOTES
// "Per-clip regen" section).
//
// Error + long-wait states per spec §10.1 + §10.2.
// Realtime subscription on clips (job_id filter) so re-renders surface
// in-place when Modal completes.

'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';
import { useRealtimeRow } from '@/hooks/use-realtime-row';
import { regenClipFromText } from '@/app/actions/regen-clip-from-text';
import { savePlanClipMotion } from '@/app/actions/video-page/save-plan-clip-motion';
import type { TaiChiMove } from '@/lib/tai-chi-moves';
import { publicVideoUrl } from '@/lib/storage-url';
import { dedupeClipsByStoragePath } from '@/lib/dedupe-clips';
import { MotionPickerSheet } from './_shared/motion-picker-sheet';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** One distinct rendered version of a clip (dedupe by storage_path) */
interface ClipVersion {
  id: string;
  storagePath: string;
  videoUrl: string;
  duration_s: number | null;
  motion_ref_slug: string | null;
  createdAt: string;
}

interface Props {
  /** The video's ID — passed to regenClipFromText */
  videoId: string;
  /** job_id of the draft job — used to filter the Realtime clips subscription */
  jobId: string;
  parshaSlug: string;
  /** All clip rows for this job, sorted by index ascending */
  initialClips: ClipRow[];
  /** The Tai Chi move library (server-fetched, passed down) */
  moves: TaiChiMove[];
  /** Called after user taps "Preview stitched video →" */
  onAdvance: () => void;
  /** Called after user taps "← Back to plan" */
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Dedupe helper — thin mapper over the shared dedupeClipsByStoragePath util.
// ---------------------------------------------------------------------------

/**
 * Converts deduplicated ClipRow[] for a single index into ClipVersion[]
 * (oldest-to-newest, matching legacy behavior).
 */
function toClipVersions(dedupedRows: ClipRow[]): ClipVersion[] {
  return dedupedRows.map((r) => ({
    id: r.id,
    storagePath: r.storage_path!,
    videoUrl: publicVideoUrl(r.storage_path!),
    duration_s: r.duration_s,
    motion_ref_slug: r.motion_ref_slug,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Phase3Clips (outer)
// ---------------------------------------------------------------------------

export function Phase3Clips({ videoId, jobId, parshaSlug, initialClips, moves, onAdvance, onBack }: Props) {
  // Realtime subscription on clips for this job so re-renders appear in-place
  const clips = useRealtimeRows<ClipRow>('clips', 'job_id', jobId, initialClips);

  // Dedupe all clips by storage_path within each index, then build per-index
  // structures for rendering. The shared helper handles sorting + deduping.
  const dedupedByIndex = dedupeClipsByStoragePath(clips);
  const indexes = Object.keys(dedupedByIndex).map(Number).sort((a, b) => a - b);

  // We still need the full (non-deduped) rows per index to find the latestRow.
  const byIndex = new Map<number, ClipRow[]>();
  for (const c of clips) {
    if (!byIndex.has(c.index)) byIndex.set(c.index, []);
    byIndex.get(c.index)!.push(c);
  }

  return (
    <section>
      {indexes.map((idx) => {
        const versions = toClipVersions(dedupedByIndex[idx] ?? []);
        // The "latest" clip row (most recent created_at with a storage_path)
        const allRowsForIdx = byIndex.get(idx) ?? [];
        const latestRow = allRowsForIdx
          .filter((r) => r.storage_path)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;

        if (!latestRow || versions.length === 0) return null;

        return (
          <ClipCard
            key={idx}
            clipIndex={idx}
            latestRow={latestRow}
            versions={versions}
            videoId={videoId}
            parshaSlug={parshaSlug}
            moves={moves}
          />
        );
      })}

      {/* Sticky bottom action bar per spec §7 */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'white',
          borderTop: '1px solid var(--ink-100)',
          padding: '10px 0 max(16px, env(safe-area-inset-bottom))',
          marginTop: 16,
        }}
      >
        <button
          type="button"
          onClick={onAdvance}
          style={{
            width: '100%',
            minHeight: 48,
            fontSize: 15,
            fontWeight: 500,
            background: 'var(--navy-700)',
            color: 'var(--linen-50)',
            border: 'none',
            borderRadius: 10,
            padding: 14,
            cursor: 'pointer',
          }}
        >
          Preview stitched video →
        </button>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ink-500)',
              textDecoration: 'underline',
              fontSize: 13,
              cursor: 'pointer',
              minHeight: 44,
              padding: '0 8px',
            }}
          >
            ← Back to plan
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ClipCard
// ---------------------------------------------------------------------------

interface ClipCardProps {
  clipIndex: number;
  latestRow: ClipRow;
  versions: ClipVersion[];
  videoId: string;
  parshaSlug: string;
  moves: TaiChiMove[];
}

function ClipCard({ clipIndex, latestRow, versions, videoId, parshaSlug, moves }: ClipCardProps) {
  // Version picker state — latest version by default (last in sorted array)
  const [selectedVersionIdx, setSelectedVersionIdx] = useState(versions.length - 1);
  const displayed = versions[selectedVersionIdx] ?? versions[versions.length - 1];

  // Motion picker state — track what slug the clip is rendered with (frozen at mount)
  // vs. what the user has picked since (may differ = stale)
  const [renderedWithSlug] = useState<string | null>(latestRow.motion_ref_slug);
  const [motionSlug, setMotionSlug] = useState<string | null>(latestRow.motion_ref_slug);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Regen job tracking — we get the jobId back from regenClipFromText and
  // subscribe to that row for error/in-flight states.
  const [regenJobId, setRegenJobId] = useState<string | null>(null);
  const [regenStartedAt, setRegenStartedAt] = useState<Date | null>(null);
  const regenJob = useRealtimeRow<{
    id: string;
    status: string;
    status_message: string | null;
    triggered_at: string;
  }>('jobs', regenJobId, null);

  const isStale = motionSlug !== renderedWithSlug;
  const currentMove = moves.find((m) => m.slug === motionSlug) ?? null;

  // Elapsed time for long-wait UX (spec §10.2)
  const now = Date.now();
  const elapsedSec = regenStartedAt ? (now - regenStartedAt.getTime()) / 1000 : 0;
  const longWait = elapsedSec > 300; // 5 min
  const stuckWait = elapsedSec > 720; // 12 min

  const IN_FLIGHT_STATUSES = ['queued', 'generating_clips', 'verifying', 'stitching'];
  const isInFlight = regenJob !== null && IN_FLIGHT_STATUSES.includes(regenJob.status);
  const isFailed = regenJob !== null && regenJob.status === 'failed';

  async function handleRegen() {
    const result = await regenClipFromText({ videoId, clipIndex });
    if ('error' in result) {
      toast.error('Re-render failed to start.', { description: result.error });
      return;
    }
    setRegenJobId(result.jobId);
    setRegenStartedAt(new Date());
  }

  async function pickMotion(slug: string | null) {
    const prev = motionSlug;
    setMotionSlug(slug); // optimistic
    const result = await savePlanClipMotion(latestRow.id, slug, parshaSlug);
    if (!result.ok) {
      setMotionSlug(prev); // revert
      toast.error("Couldn't save the move.", { description: result.error });
    }
  }

  // ---------------------------------------------------------------------------
  // Failed state (spec §10.1)
  // ---------------------------------------------------------------------------
  if (isFailed && regenJob) {
    return (
      <div
        style={{
          border: '1px solid var(--ink-100)',
          borderLeft: '4px solid var(--tassel)',
          borderRadius: 10,
          padding: 12,
          marginBottom: 12,
          background: 'var(--linen-50)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <strong style={{ fontSize: 13 }}>Clip {clipIndex + 1} — re-render failed</strong>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-700)', margin: '0 0 10px' }}>
          {regenJob.status_message || 'Unknown error.'}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleRegen}
            style={{
              minHeight: 44,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              background: 'white',
              color: 'var(--navy-700)',
              border: '1px solid var(--navy-700)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
          <a
            href={`/jobs/${regenJob.id}`}
            style={{ fontSize: 12, color: 'var(--ink-500)', textDecoration: 'underline' }}
          >
            View logs →
          </a>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // In-flight state (spec §10.2)
  // ---------------------------------------------------------------------------
  if (isInFlight) {
    return (
      <div
        style={{
          border: '1px solid var(--ink-100)',
          borderRadius: 10,
          padding: 12,
          marginBottom: 12,
          background: 'var(--linen-50)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {/* Spinner (CSS pulse-navy animation per EXECUTION-NOTES) */}
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: 'var(--navy-700)',
              animation: 'pulse-navy 1.8s ease-in-out infinite',
            }}
          />
          <strong style={{ fontSize: 13 }}>Clip {clipIndex + 1} — Generating…</strong>
        </div>
        <p
          style={{
            fontSize: 12,
            color: 'var(--ink-500)',
            fontStyle: 'italic',
            margin: '0 0 6px',
          }}
        >
          queued at Kie · waiting
        </p>
        {longWait && !stuckWait && (
          <p style={{ fontSize: 12, color: 'var(--ink-700)', margin: '6px 0 0' }}>
            This is taking longer than usual — Kie&apos;s queue is busy.
          </p>
        )}
        {stuckWait && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--ink-700)', margin: '6px 0 8px' }}>
              Still queued — you can leave this page and come back.
            </p>
            <button
              type="button"
              onClick={() => {
                // TODO: cancel action — out of scope this milestone
                toast('Cancel-and-retry not yet implemented.');
              }}
              style={{
                minHeight: 44,
                padding: '8px 14px',
                fontSize: 13,
                background: 'white',
                color: 'var(--tassel)',
                border: '1px solid var(--tassel)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Cancel and retry
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Normal card (spec §4 Phase 3)
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        border: '1px solid var(--ink-100)',
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
        background: 'var(--linen-50)',
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--jade)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          ● Clip {clipIndex + 1}
          {displayed.duration_s ? ` · ${displayed.duration_s}s` : ''}
        </span>

        {/* Version picker dropdown — IS the undo mechanism (spec §4 Phase 3) */}
        {versions.length > 1 && (
          <select
            value={selectedVersionIdx}
            onChange={(e) => setSelectedVersionIdx(Number(e.target.value))}
            style={{
              minHeight: 36,
              fontSize: 13,
              padding: '4px 8px',
              border: '1px solid var(--ink-100)',
              borderRadius: 6,
              background: 'white',
              color: 'var(--ink-700)',
              cursor: 'pointer',
            }}
          >
            {versions.map((v, i) => (
              <option key={v.id} value={i}>
                v{i + 1}
                {i === versions.length - 1 ? ' (latest)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Mini-player — full-width, 9:16, tap to play (spec §4 Phase 3) */}
      <video
        key={displayed.storagePath}
        src={displayed.videoUrl}
        controls
        playsInline
        preload="metadata"
        style={{
          width: '100%',
          aspectRatio: '9 / 16',
          borderRadius: 8,
          background: 'var(--ink-900)',
          display: 'block',
        }}
      />

      {/* Tai Chi move picker (spec §6.5) */}
      <label
        style={{
          display: 'block',
          fontSize: 11,
          color: 'var(--ink-700)',
          margin: '10px 0 3px',
        }}
      >
        Tai Chi move
      </label>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        style={{
          width: '100%',
          minHeight: 44,
          padding: '10px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'white',
          border: '1px solid var(--ink-100)',
          borderRadius: 6,
          fontSize: 14,
          cursor: 'pointer',
          boxSizing: 'border-box',
        }}
      >
        <span>{currentMove ? `🥋 ${currentMove.english}` : 'No move assigned'}</span>
        <span style={{ color: 'var(--ink-500)' }}>▾</span>
      </button>

      {/* Stale hint (spec §6.5) */}
      {isStale && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--tassel)',
            margin: '6px 0 0',
            fontStyle: 'italic',
          }}
        >
          Move changed — re-render to apply.
        </p>
      )}

      <MotionPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        moves={moves}
        currentSlug={motionSlug}
        onPick={pickMotion}
      />

      {/* Re-render button — calls regenClipFromText per EXECUTION-NOTES */}
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={handleRegen}
          style={{
            width: '100%',
            minHeight: 44,
            fontSize: 13,
            fontWeight: 500,
            background: 'white',
            color: 'var(--navy-700)',
            border: '1px solid var(--navy-700)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {isStale ? 'Re-render with new move' : 'Re-render'}
        </button>
      </div>
    </div>
  );
}
