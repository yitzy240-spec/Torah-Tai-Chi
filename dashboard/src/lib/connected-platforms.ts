import { listProfiles } from '@/lib/buffer';
import { getConnection as getYouTubeConnection } from '@/lib/youtube';
import { PLATFORMS, type Platform } from '@/lib/platforms';

/**
 * Detect which platforms are actually wired up:
 *   - YouTube: oauth_tokens row with service='youtube' present
 *   - All others (TikTok, Instagram, Facebook, X): a Buffer profile
 *     for that service
 *
 * Returns an array of Platform names. Empty array on errors so the UI
 * doesn't accidentally over-promise connectivity if Buffer is down.
 */
export async function getConnectedPlatforms(): Promise<Platform[]> {
  const connected = new Set<Platform>();

  // Buffer-backed channels.
  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;
  if (bufferToken) {
    try {
      const profiles = await listProfiles(bufferToken);
      for (const p of profiles) {
        const svc = (p.service ?? '').toLowerCase();
        if ((PLATFORMS as readonly string[]).includes(svc)) {
          connected.add(svc as Platform);
        }
      }
    } catch {
      // Network/auth failure: treat Buffer-backed platforms as not
      // connected. Better to silently hide than to falsely promise.
    }
  }

  // YouTube goes direct.
  try {
    const yt = await getYouTubeConnection();
    if (yt.connected) connected.add('youtube');
  } catch {
    // Same as above.
  }

  // Preserve PLATFORMS ordering for predictable UI.
  return PLATFORMS.filter((p) => connected.has(p));
}
