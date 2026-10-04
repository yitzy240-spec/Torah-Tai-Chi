'use client';

import { useId, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer';
import WatchOnRow from '@/components/WatchOnRow';
import type { ParshaVideo } from '@/lib/parsha-videos';

interface Props {
  videos: ParshaVideo[];
  parshaSlug: string;
  /** Display name — "Bereishit", or "Matot-Masei" on a double week. */
  parshaName: string;
  showLabel: string;
  hideLabel: string;
  watchOnLabel: string;
}

/**
 * Every earlier teaching on this parsha — previous years' videos and any
 * other idea taught on it — behind one button under the hero. Nothing that
 * was ever published comes down; it just stops being the hero.
 *
 * Collapsed by default, and the players only mount when it opens, so a
 * parsha with five years of videos costs the visitor nothing until they ask.
 */
export default function EarlierTeachings({
  videos,
  parshaSlug,
  parshaName,
  showLabel,
  hideLabel,
  watchOnLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (videos.length === 0) return null;

  return (
    <section className="earlier-section" aria-label={showLabel}>
      <button
        type="button"
        className="earlier-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? hideLabel : `${showLabel} (${videos.length})`}
      </button>

      {open && (
        <ol id={listId} className="earlier-list">
          {videos.map((v) => {
            const heading = v.subtitle ?? v.title ?? parshaName;
            return (
              <li key={v.id} className="earlier-item">
                <div className="earlier-meta">
                  {v.hebrewYear && <span className="earlier-year">{v.hebrewYear}</span>}
                  <span className="earlier-title">{heading}</span>
                </div>
                <div className="vd-player earlier-player">
                  <VideoPlayer
                    src={v.videoUrl}
                    poster={v.thumbUrl ?? undefined}
                    className="vd-video-el"
                    videoId={`${parshaSlug}/${v.id}`}
                    title={v.hebrewYear ? `${parshaName} (${v.hebrewYear})` : parshaName}
                  />
                </div>
                {v.postUrls && Object.keys(v.postUrls).length > 0 && (
                  <WatchOnRow postUrls={v.postUrls} label={watchOnLabel} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
