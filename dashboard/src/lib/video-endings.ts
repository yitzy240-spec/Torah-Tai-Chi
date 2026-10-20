/**
 * Per-platform video endings (2026-10-20). The pipeline renders every
 * final video twice from the same stitched content; only the branded
 * outro card differs:
 *
 *   follow    → videos.mp4_path            "Follow for a new lesson every week"
 *               Facebook / Instagram / TikTok / X
 *   subscribe → videos.mp4_subscribe_path  "Subscribe for a new lesson every week"
 *               YouTube
 *
 * mp4_subscribe_path is null on rows rendered before the change (and when
 * the subscribe cut failed), so every subscribe read falls back to
 * mp4_path. Keep ALL platform→ending decisions here so posting and the
 * download buttons can't drift apart.
 *
 * Dependency-free on purpose: run by `node --test` without the @/ alias.
 */

export type Ending = 'follow' | 'subscribe';

export interface VideoEndingPaths {
  mp4_path: string | null | undefined;
  mp4_subscribe_path?: string | null;
}

/** YouTube's own verb is "subscribe"; everywhere else viewers "follow". */
export function endingForPlatform(platform: string): Ending {
  return platform === 'youtube' ? 'subscribe' : 'follow';
}

/** Storage path for an ending, falling back to the follow cut
 *  (mp4_path) when the subscribe cut is missing. */
export function videoPathForEnding(video: VideoEndingPaths, ending: Ending): string | null {
  if (ending === 'subscribe' && video.mp4_subscribe_path) return video.mp4_subscribe_path;
  return video.mp4_path || null;
}

export function videoPathForPlatform(video: VideoEndingPaths, platform: string): string | null {
  return videoPathForEnding(video, endingForPlatform(platform));
}

/** `<parsha>-follow.mp4` / `<parsha>-subscribe.mp4`. */
export function endingDownloadFilename(parshaSlug: string | null | undefined, ending: Ending): string {
  const slug = (parshaSlug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'torah-tai-chi'}-${ending}.mp4`;
}

export const ENDING_DOWNLOAD_LABELS: Record<Ending, string> = {
  follow: 'Download for Facebook / IG / TikTok (Follow ending)',
  subscribe: 'Download for YouTube (Subscribe ending)',
};
