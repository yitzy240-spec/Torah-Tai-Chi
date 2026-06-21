'use client';

import { useRef } from 'react';
import { track } from '@/lib/analytics';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Stable id for the video (the parsha slug) — groups events in GA. */
  videoId: string;
  /** Human title (parsha name) for readable GA reports. */
  title: string;
}

const PROGRESS_MARKS = [25, 50, 75] as const;

/**
 * Native <video> wrapper that fires GA4 engagement events:
 *   - video_start    on first play
 *   - video_progress at 25 / 50 / 75% watched
 *   - video_complete on end
 * Each fires at most once per mount (ref-backed set), so seeking back and
 * forth doesn't double-count. track() no-ops when GA isn't loaded, so this is
 * inert in dev/preview and harmless if GA ever fails to load.
 */
export default function VideoPlayer({
  src,
  poster,
  className,
  style,
  videoId,
  title,
}: VideoPlayerProps) {
  const fired = useRef<Set<string>>(new Set());
  const base = { video_id: videoId, video_title: title };

  const fireOnce = (key: string, event: string, extra?: Record<string, number>) => {
    if (fired.current.has(key)) return;
    fired.current.add(key);
    track(event, { ...base, ...extra });
  };

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={src}
      poster={poster}
      controls
      playsInline
      preload="metadata"
      className={className}
      style={style}
      onPlay={() => fireOnce('start', 'video_start')}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (!v.duration || Number.isNaN(v.duration)) return;
        const pct = (v.currentTime / v.duration) * 100;
        for (const m of PROGRESS_MARKS) {
          if (pct >= m) fireOnce(`p${m}`, 'video_progress', { percent: m });
        }
      }}
      onEnded={() => fireOnce('complete', 'video_complete')}
    />
  );
}
