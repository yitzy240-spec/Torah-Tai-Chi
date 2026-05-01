import { createServiceClient } from '@/lib/supabase/service';
import { getPostExternalLinks } from '@/lib/buffer';

/**
 * Resolve Buffer-backed posts' externalLinks for a single video and
 * merge the URLs into videos.post_urls so the public website can link
 * to them directly. Best-effort: silently no-ops when Buffer isn't
 * configured or the lookup fails — the next render will retry.
 *
 * YouTube URLs are written at upload time in auto-post.ts; this only
 * handles the Buffer path (TikTok/Instagram/Facebook/X), where the
 * externalLink is async and may not be resolvable until a few minutes
 * after the post is queued.
 */
export async function refreshVideoPostUrls(videoId: string): Promise<void> {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) return;

  const sb = createServiceClient();

  // Posts on this video that still need a URL resolved. Skip YouTube
  // (handled at upload), and skip rows that already have a post_url.
  const { data: posts } = await sb
    .from('posts')
    .select('id, platform, buffer_update_id')
    .eq('video_id', videoId)
    .neq('platform', 'youtube')
    .is('post_url', null);
  const candidates = (posts ?? []).filter(
    (p): p is { id: string; platform: string; buffer_update_id: string } =>
      typeof p.buffer_update_id === 'string' && p.buffer_update_id.length > 0,
  );
  if (candidates.length === 0) return;

  let links: Record<string, string | null>;
  try {
    links = await getPostExternalLinks(
      token,
      candidates.map((c) => c.buffer_update_id),
    );
  } catch (e) {
    console.warn('[refreshVideoPostUrls] Buffer lookup failed:', e);
    return;
  }

  // Pull current videos.post_urls once, merge all platforms in one update.
  const { data: vRow } = await sb
    .from('videos').select('post_urls').eq('id', videoId).maybeSingle();
  const merged: Record<string, string> = {
    ...((vRow?.post_urls as Record<string, string> | null) ?? {}),
  };
  let videosChanged = false;

  for (const c of candidates) {
    const url = links[c.buffer_update_id];
    if (!url) continue;
    // Update the per-row posts.post_url for audit + downstream uses.
    await sb.from('posts').update({ post_url: url }).eq('id', c.id);
    if (merged[c.platform] !== url) {
      merged[c.platform] = url;
      videosChanged = true;
    }
  }

  if (videosChanged) {
    await sb.from('videos').update({ post_urls: merged }).eq('id', videoId);
  }
}
