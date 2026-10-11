// dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/site-cover-picker.tsx
//
// "Website cover image" control for the Site cards. Scrub the video to a
// frame, tap the button, and that frame becomes videos.thumb_path — the
// image torahtaichi.com shows on the player before Play and on the video
// cards. Saves (and busts the website cache) on its own; no separate
// "Publish changes" needed.

'use client';
import { useState } from 'react';
import { FramePicker, blobToDataUrl } from './frame-picker';
import { saveSiteThumbnail } from '@/app/actions/video-page/save-site-thumbnail';

interface Props {
  videoId: string;
  parshaSlug: string;
  videoUrl: string | null;
  thumbUrl: string | null;
  isLive: boolean;
}

export function SiteCoverPicker({ videoId, parshaSlug, videoUrl, thumbUrl, isLive }: Props) {
  const [savedAt, setSavedAt] = useState<string | null>(null);

  if (!videoUrl) return null;

  async function handlePick(blob: Blob): Promise<void> {
    setSavedAt(null);
    const res = await saveSiteThumbnail(videoId, parshaSlug, await blobToDataUrl(blob));
    if (!res.ok) throw new Error(res.error);
    setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <div>
      <FramePicker
        videoUrl={videoUrl}
        initialThumbUrl={thumbUrl}
        onPick={handlePick}
        label="Website cover image (shown before the video plays)"
        buttonLabel="Use this frame as the website cover"
      />
      {savedAt && (
        <div style={{ fontSize: 12, color: 'var(--jade)', marginTop: -8, marginBottom: 12 }}>
          {isLive
            ? `New cover saved at ${savedAt} — live on torahtaichi.com within a minute.`
            : `New cover saved at ${savedAt}.`}
        </div>
      )}
    </div>
  );
}
