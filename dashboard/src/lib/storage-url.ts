const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

function supabaseOrigin(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL ?? '';
}

/**
 * Turn a compose-job completed_at (or any date/number) into a stable
 * cache-bust token. Re-stitch overwrites the same storage path, so the
 * URL itself has to change or iOS Safari will reuse cached byte ranges
 * from the previous file (which has a different length).
 *
 * ISO timestamps collapse to epoch milliseconds so equivalent instants
 * in different formats produce the same token.
 */
export function assetVersionToken(
  version: string | number | null | undefined,
): string | null {
  if (version == null || version === '') return null;
  if (typeof version === 'number' && Number.isFinite(version)) {
    return String(Math.trunc(version));
  }
  const raw = String(version);
  if (/^\d+$/.test(raw)) return raw;
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return String(ms);
  return raw;
}

/** Append `?v=` (or `&v=`) with a per-version token. No-ops if missing. */
export function withAssetVersion(
  url: string,
  version: string | number | null | undefined,
): string {
  const token = assetVersionToken(version);
  if (!url || !token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(token)}`;
}

export function publicVideoUrl(
  path: string,
  version?: string | number | null,
): string {
  const url = `${supabaseOrigin()}/storage/v1/object/public/videos/${path.replace(/^\/+/, '')}`;
  return withAssetVersion(url, version);
}

export function publicClipUrl(path: string, version?: string | number | null): string {
  const url = `${supabaseOrigin()}/storage/v1/object/public/clips/${path.replace(/^\/+/, '')}`;
  return withAssetVersion(url, version);
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
