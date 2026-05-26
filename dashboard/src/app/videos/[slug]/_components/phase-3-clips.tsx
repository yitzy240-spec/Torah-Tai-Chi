// dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx
//
// Phase 3: Clips. Per-clip cards with inline 9:16 mini-player,
// version picker (sourced from initialVersionsByIndex — rendered
// versions across regen child jobs, newest first), motion picker
// (spec §6.5), and per-card "Re-render" which calls the EXISTING
// regenClipFromText server action — NOT triggerClips.
//
// IMPORTANT: the realtime sub on clips.job_id = jobId only sees the
// plan-only's clip rows. New renders land under child job_ids and
// would never show up in the picker. We instead drive the picker
// from initialVersionsByIndex (server-fetched in phase-3-data via
// regen_of_job_id = draftJobId). That mirrors Phase 2's approach and
// keeps a single source of truth for "which version of each clip the
// operator picked" via the shared localStorage key. The realtime sub
// still drives the metadata overlay (voiceover, scene, motion_ref).
//
// Error + long-wait states per spec §10.1 + §10.2.

'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';
import { useRealtimeRow } from '@/hooks/use-realtime-row';
import { regenClipFromText } from '@/app/actions/regen-clip-from-text';
import { savePlanClipMotion } from '@/app/actions/video-page/save-plan-clip-motion';
import type { TaiChiMove } from '@/lib/tai-chi-moves';
import type { ClipVersion } from '../_data/phase-2-data';
import { publicVideoUrl } from '@/lib/storage-url';
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

interface Props {
  /** The video's ID — passed to regenClipFromText */
  videoId: string;
  /** job_id of the draft job — used to filter the Realtime clips subscription */
  jobId: string;
  parshaSlug: string;
  /** All plan-only clip rows for this job, sorted by index ascending.
   *  Source of metadata (voiceover, scene, motion_ref) — NOT the
   *  rendered mp4 paths (those live in initialVersionsByIndex). */
  initialClips: ClipRow[];
  /** All rendered versions per clip index (regen child jobs),
   *  newest first. Drives the version picker + player. */
  initialVersionsByIndex: Record<number, ClipVersion[]>;
  /** The Tai Chi move library (server-fetched, passed down) */
  moves: TaiChiMove[];
  /** Called after user taps "Preview stitched video →" */
  onAdvance: () => void;
  /** Called after user taps "← Back to plan" */
  onBack: () => void;
  /** True while the parent's handleAdvance is in flight — gates the
   *  Preview button so an impatient operator can't double-tap and fire
   *  composeVideo twice (duplicate Modal compose jobs racing). */
  advancing?: boolean;
}

// ---------------------------------------------------------------------------
// Phase3Clips (outer)
// ---------------------------------------------------------------------------

export function Phase3Clips({
  videoId,
  jobId,
  parshaSlug,
  initialClips,
  initialVersionsByIndex,
  moves,
  onAdvance,
  onBack,
  advancing = false,
}: Props) {
  // Realtime subscription on plan-only clips so metadata edits (motion
  // picker, etc.) reflect in-place. The rendered versions don't come
  // through here — they come from initialVersionsByIndex (server fetch).
  const planClips = useRealtimeRows<ClipRow>('clips', 'job_id', jobId, initialClips).sort(
    (a, b) => a.index - b.index,
  );

  return (
    <section>
      {planClips.map((clip) => {
        const versions = initialVersionsByIndex[clip.index] ?? [];
        // Only render a card if there's a rendered version to show. A
        // plan-only clip with no renders shouldn't appear in Phase 3 —
        // the operator should be sent back to Phase 2 to render it
        // first. (Phase 2's all-rendered gate ensures this in practice.)
        if (versions.length === 0) return null;

        return (
          <ClipCard
            key={clip.id}
            planClip={clip}
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
          disabled={advancing}
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
            cursor: advancing ? 'wait' : 'pointer',
            opacity: advancing ? 0.7 : 1,
          }}
        >
          {advancing ? 'Starting…' : 'Preview stitched video →'}
        </button>
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 11.5, color: 'var(--ink-500)', fontFamily: 'var(--ff-display)', fontStyle: 'italic', lineHeight: 1.5 }}>
          Stitches using the latest version selected for each clip. Usually 1–3 minutes.
        </div>
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
  /** The plan-only clip row — provides metadata + the localStorage key
   *  base. Its id is the key Phase 2 also uses. */
  planClip: ClipRow;
  /** All rendered versions for this clip index, newest first. */
  versions: ClipVersion[];
  videoId: string;
  parshaSlug: string;
  moves: TaiChiMove[];
}

function ClipCard({ planClip, versions, videoId, parshaSlug, moves }: ClipCardProps) {
  // Version selection mirrors Phase 2's pattern: localStorage-backed,
  // keyed on the plan-only clip id (NOT a rendered clip id), with the
  // value being the rendered clip id. Default = newest (versions[0]).
  // The key format matches Phase 2 — compose-on-advance reads the same
  // key in phase-3-clips-connected.handleAdvance.
  const versionLsKey = `plan.${parshaSlug}.${planClip.id}.selected_clip_id`;
  const [selectedClipId, setSelectedClipId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return versions[0]?.clipId ?? null;
    const stored = window.localStorage.getItem(versionLsKey);
    if (stored && versions.some((v) => v.clipId === stored)) return stored;
    return versions[0]?.clipId ?? null;
  });
  const selectedVersion =
    versions.find((v) => v.clipId === selectedClipId) ?? versions[0] ?? null;
  const isOnLatest = selectedVersion?.clipId === versions[0]?.clipId;

  function pickVersion(clipId: string) {
    setSelectedClipId(clipId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(versionLsKey, clipId);
    }
  }

  // Auto-jump to the newest version when a re-render lands — but only
  // if the operator hadn't manually picked an older one (no stored
  // value). Mirrors Phase 2.
  useEffect(() => {
    if (versions.length === 0) return;
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(versionLsKey);
    if (!stored) {
      setSelectedClipId(versions[0].clipId);
    }
  }, [versions, versionLsKey]);

  // Motion picker state — track what slug the clip's plan row currently
  // holds vs. what the user has picked since (may differ = stale).
  const [renderedWithSlug] = useState<string | null>(planClip.motion_ref_slug);
  const [motionSlug, setMotionSlug] = useState<string | null>(planClip.motion_ref_slug);
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

  const router = useRouter();

  // When the regen completes, refresh the page so the server re-fetches
  // initialVersionsByIndex and the new version appears as a picker
  // option. Without this, the just-rendered clip would not surface
  // until the operator manually reloaded.
  useEffect(() => {
    if (regenJob?.status === 'done') {
      setRegenJobId(null);
      setRegenStartedAt(null);
      router.refresh();
    }
  }, [regenJob?.status, router]);

  async function handleRegen() {
    const result = await regenClipFromText({ videoId, clipIndex: planClip.index });
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
    const result = await savePlanClipMotion(planClip.id, slug, parshaSlug);
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
          <strong style={{ fontSize: 13 }}>Clip {planClip.index + 1} — re-render failed</strong>
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
          <strong style={{ fontSize: 13 }}>Clip {planClip.index + 1} — Generating…</strong>
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
  if (!selectedVersion) return null;

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
          ● Clip {planClip.index + 1}
          {planClip.duration_s ? ` · ${planClip.duration_s}s` : ''}
        </span>
      </div>

      {/* Mini-player — full-width, 9:16, tap to play (spec §4 Phase 3).
          Keyed on the selected version's clip id so flipping between
          versions remounts the <video> with the new src. */}
      <video
        key={selectedVersion.clipId}
        src={publicVideoUrl(selectedVersion.storagePath)}
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

      {/* Version chips — only when 2+ versions exist. Mirrors Phase 2's
          row: v1 oldest on the left, v{N} newest on the right. Server
          passes versions newest-first, so we walk in reverse for display. */}
      {versions.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            justifyContent: 'center',
            marginTop: 10,
          }}
        >
          {versions
            .slice()
            .reverse()
            .map((v, displayIdx) => {
              const versionNumber = displayIdx + 1;
              const isSelected = v.clipId === selectedClipId;
              const tierLabel =
                v.resolution && v.modelTier
                  ? `${v.resolution} ${v.modelTier === 'standard' ? 'Standard' : 'Fast'}`
                  : null;
              return (
                <button
                  key={v.clipId}
                  type="button"
                  onClick={() => pickVersion(v.clipId)}
                  aria-pressed={isSelected}
                  title={tierLabel ? `v${versionNumber} · ${tierLabel}` : `v${versionNumber}`}
                  style={{
                    minHeight: 32,
                    padding: '5px 12px',
                    fontSize: 12.5,
                    fontWeight: 500,
                    borderRadius: 999,
                    cursor: 'pointer',
                    background: isSelected ? 'var(--navy-700)' : 'white',
                    color: isSelected ? 'var(--linen-50)' : 'var(--ink-700)',
                    border: `1px solid ${isSelected ? 'var(--navy-700)' : 'var(--ink-200)'}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  v{versionNumber}
                </button>
              );
            })}
        </div>
      )}

      {/* Tier label + 'jump to newest' link */}
      <div
        style={{
          textAlign: 'center',
          marginTop: 8,
          fontSize: 11,
          color: 'var(--ink-500)',
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
        }}
      >
        {selectedVersion.resolution && selectedVersion.modelTier
          ? `${selectedVersion.resolution} ${selectedVersion.modelTier === 'standard' ? 'Standard' : 'Fast'}`
          : 'rendered'}
        {!isOnLatest && versions.length > 1 && (
          <>
            {' · '}
            <button
              type="button"
              onClick={() => pickVersion(versions[0].clipId)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--navy-700)',
                fontStyle: 'italic',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              jump to newest
            </button>
          </>
        )}
      </div>

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
