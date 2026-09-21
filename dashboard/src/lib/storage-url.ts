const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export function publicVideoUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/videos/${path.replace(/^\/+/, '')}`;
}

export function publicClipUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/clips/${path.replace(/^\/+/, '')}`;
}

/** Turn a public storage URL into a forced-download URL.
 *
 * The bare `<a download>` attribute is IGNORED for cross-origin URLs, so
 * tapping "Download mp4" on an iPhone just opened the player with no way
 * to save (Yonah, Ki Tavo manual-posting week). Supabase storage's
 * `?download=<name>` serves `Content-Disposition: attachment` (verified
 * against prod storage), which makes every browser — iOS Safari included
 * — actually download the file. */
export function downloadUrl(url: string, filename: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}download=${encodeURIComponent(filename)}`;
}

export const PLACEHOLDER_THUMB_URL = publicVideoUrl('placeholders/video_placeholder.png');
