'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { VersionSelector } from './version-selector';
import { CompareView } from './compare-view';
import { VideoFeedback, type FeedbackClip } from './video-feedback';
import { RegenInProgressBanner, type InFlightJob } from './regen-in-progress-banner';

/**
 * Owns the per-parsha version state on the /videos/[slug] page. The server
 * fetches every done version chronologically and hands us a `versions[]` —
 * we resolve "which version is selected" from `?v=<videoId>` (or default
 * to the latest) and "is compare mode on?" from `?compare=1`.
 *
 * Why this lives in one client component: URL is the source of truth so a
 * link like /videos/emor?v=<id>&compare=1 reproduces the exact view, but
 * we don't want a full server re-render each time Yonah taps a chevron.
 * router.replace + local state gives us snappy switching with shareable
 * URLs.
 */

export interface VersionInfo {
  /** videos.id */
  id: string;
  videoUrl: string | null;
  thumbUrl: string | null;
  captionsVttDataUrl: string | null;
  clips: FeedbackClip[];
  costEstimateUsd: number | null;
  resolutionLabel: string | null;
  /** ISO timestamp of videos.created_at. */
  createdAt: string;
  /** True if this version's job has regen_of_job_id set (i.e. not v1). */
  isRegen: boolean;
  /** The feedback.text that was applied to this version's job, if any. */
  feedbackText: string | null;
  /** True when every clip on this version's job has a Storage checkpoint
   * (storage_path) AND a clip_plan exists — i.e. general feedback on
   * this version will route to smart regen rather than full regen. */
  smartRegenAvailable: boolean;
}

interface Props {
  versions: VersionInfo[];
  initialSelectedId: string;
  initialCompare: boolean;
  /** An in-flight regen job for this parsha, if any. When present we
   *  render the RegenInProgressBanner above the version selector so the
   *  user can see "a new version is being made" and click through to
   *  /jobs/<id> for the verbose progress view. */
  inFlightRegen?: InFlightJob | null;
  typicalRun?: { lowMin: number; highMin: number } | null;
  /** Forwarded to VideoFeedback. When true, the per-clip feedback list is
   *  suppressed because the parent surface is rendering its own editable
   *  clip cards (avoids duplicate UI). */
  hidePerClipFeedback?: boolean;
}

export function VideoVersionsView({
  versions,
  initialSelectedId,
  initialCompare,
  inFlightRegen,
  typicalRun,
  hidePerClipFeedback = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialIndex = useMemo(() => {
    const i = versions.findIndex((v) => v.id === initialSelectedId);
    return i >= 0 ? i : versions.length - 1;
  }, [versions, initialSelectedId]);

  const [selectedIndex, setSelectedIndex] = useState<number>(initialIndex);
  const [compareMode, setCompareMode] = useState<boolean>(
    initialCompare && versions.length >= 2,
  );

  const selected = versions[selectedIndex] ?? versions[versions.length - 1];
  const previous = compareMode && selectedIndex > 0 ? versions[selectedIndex - 1] : null;

  /** Push URL state without a full server re-render. We keep any unrelated
   *  query params intact (defensive — there aren't any today, but the
   *  compose flow has historically grown ad-hoc params we don't want to
   *  clobber). */
  const updateUrl = useCallback(
    (videoId: string, compare: boolean) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('v', videoId);
      if (compare) params.set('compare', '1');
      else params.delete('compare');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const handleNavigate = useCallback(
    (newIndex: number) => {
      if (newIndex < 0 || newIndex >= versions.length) return;
      setSelectedIndex(newIndex);
      updateUrl(versions[newIndex].id, compareMode);
    },
    [versions, compareMode, updateUrl],
  );

  const handleToggleCompare = useCallback(() => {
    if (versions.length < 2) return;
    setCompareMode(true);
    updateUrl(versions[selectedIndex].id, true);
  }, [selectedIndex, versions, updateUrl]);

  const handleExitCompare = useCallback(() => {
    setCompareMode(false);
    updateUrl(versions[selectedIndex].id, false);
  }, [selectedIndex, versions, updateUrl]);

  const relativeTime = useMemo(() => relTime(selected.createdAt), [selected.createdAt]);
  const previousRelativeTime = useMemo(
    () => (previous ? relTime(previous.createdAt) : ''),
    [previous],
  );

  return (
    <div>
      {inFlightRegen && (
        <RegenInProgressBanner
          initialJob={inFlightRegen}
          typicalRun={typicalRun ?? null}
        />
      )}
      <VersionSelector
        total={versions.length}
        selectedIndex={selectedIndex}
        relativeTime={relativeTime}
        compareMode={compareMode}
        canCompare={versions.length >= 2}
        onNavigate={handleNavigate}
        onToggleCompare={handleToggleCompare}
        onExitCompare={handleExitCompare}
      />

      {selected.isRegen && (
        <FeedbackSubtitle text={selected.feedbackText} />
      )}

      {compareMode && previous ? (
        <CompareView
          previous={{
            videoUrl: previous.videoUrl,
            thumbUrl: previous.thumbUrl,
            captionsVttDataUrl: previous.captionsVttDataUrl,
            versionLabel: `Version ${selectedIndex} of ${versions.length}`,
            relativeTime: previousRelativeTime,
          }}
          current={{
            videoUrl: selected.videoUrl,
            thumbUrl: selected.thumbUrl,
            captionsVttDataUrl: selected.captionsVttDataUrl,
            versionLabel: `Version ${selectedIndex + 1} of ${versions.length}`,
            relativeTime,
          }}
          feedbackText={selected.feedbackText}
        />
      ) : (
        <VideoFeedback
          videoId={selected.id}
          videoUrl={selected.videoUrl}
          thumbUrl={selected.thumbUrl}
          captionsVttDataUrl={selected.captionsVttDataUrl}
          clips={selected.clips}
          costEstimateUsd={selected.costEstimateUsd}
          resolutionLabel={selected.resolutionLabel}
          smartRegenAvailable={selected.smartRegenAvailable}
          hidePerClipFeedback={hidePerClipFeedback}
        />
      )}
    </div>
  );
}

/**
 * Italicized blockquote-style subtitle showing what feedback produced this
 * regen. Long feedback collapses behind a "show more" toggle so the header
 * area doesn't visually drown the player.
 */
function FeedbackSubtitle({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) {
    return (
      <p
        style={{
          margin: '0 0 18px 0',
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '13.5px',
          color: 'var(--ink-500)',
          fontVariationSettings: '"opsz" 14, "SOFT" 60',
        }}
      >
        Regenerated from previous version
      </p>
    );
  }
  const TRUNCATE_AT = 180;
  const isLong = text.length > TRUNCATE_AT;
  const display = expanded || !isLong ? text : `${text.slice(0, TRUNCATE_AT).trimEnd()}…`;
  return (
    <p
      style={{
        margin: '0 0 18px 0',
        fontFamily: 'var(--ff-display)',
        fontStyle: 'italic',
        fontSize: '13.5px',
        color: 'var(--ink-500)',
        fontVariationSettings: '"opsz" 14, "SOFT" 60',
        lineHeight: 1.55,
      }}
    >
      <span style={{ color: 'var(--ink-400)', fontStyle: 'normal' }}>
        Generated from feedback:{' '}
      </span>
      <span style={{ color: 'var(--ink-700)' }}>&ldquo;{display}&rdquo;</span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            marginLeft: '8px',
            color: 'var(--cedar-700)',
            fontFamily: 'var(--ff-body)',
            fontStyle: 'normal',
            fontSize: '12.5px',
            cursor: 'pointer',
          }}
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      )}
    </p>
  );
}

/** "5 min ago" / "3 hr ago" / "2 days ago" — coarse, no precision past days. */
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffS = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffS < 60) return 'just now';
  const diffMin = Math.round(diffS / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo} mo ago`;
  const diffYr = Math.round(diffMo / 12);
  return `${diffYr} yr ago`;
}
