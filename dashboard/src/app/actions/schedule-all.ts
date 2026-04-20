'use server';
import { createClient } from '@/lib/supabase/server';
import { createUpdate, listProfiles } from '@/lib/buffer';
import { getConnection as getYouTubeConnection, uploadVideo as uploadToYouTube } from '@/lib/youtube';
import { PLATFORMS, BUFFER_PLATFORMS, type Platform } from '@/lib/platforms';

// Retry a promise-returning fn up to `attempts` times with ms delays between retries.
async function withRetry<T>(
  fn: () => Promise<T>,
  delays = [200, 1000],
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  throw lastErr;
}

interface ScheduleAllArgs {
  videoId: string;
  scheduledAt: Date;
  /** Per-platform captions, keyed by platform name */
  captions: Partial<Record<Platform, string>>;
  /** If true, publish immediately — ignore scheduledAt. */
  shareNow?: boolean;
}

export async function scheduleAll(
  args: ScheduleAllArgs,
): Promise<{ results?: Array<{ platform: Platform; externalId: string }>; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Fetch video URL from storage
  const { data: video } = await supabase
    .from('videos')
    .select('mp4_path, thumb_path')
    .eq('id', args.videoId)
    .single();

  let mediaUrl: string | undefined;
  let thumbUrl: string | undefined;
  if (video?.mp4_path) {
    const { data: urlData } = supabase.storage.from('videos').getPublicUrl(video.mp4_path);
    mediaUrl = urlData?.publicUrl;
  }
  if (video?.thumb_path) {
    const { data: urlData } = supabase.storage.from('videos').getPublicUrl(video.thumb_path);
    thumbUrl = urlData?.publicUrl;
  }

  const results: Array<{ platform: Platform; externalId: string }> = [];
  const errors: string[] = [];

  // Which platforms is the user actually asking us to post to?
  const requested = PLATFORMS.filter((p) => args.captions[p]);
  const needsBuffer = requested.some((p) => p !== 'youtube');
  const needsYouTube = requested.includes('youtube');

  // ── Buffer path — TikTok/Instagram/Facebook ────────────────────────────
  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;
  let profiles: Awaited<ReturnType<typeof listProfiles>> = [];
  if (needsBuffer) {
    if (!bufferToken) return { error: 'BUFFER_NOT_CONFIGURED' };
    try {
      profiles = await withRetry(() => listProfiles(bufferToken));
    } catch (e) {
      return { error: `Failed to fetch Buffer profiles: ${String(e)}. Check Settings → Buffer.` };
    }
  }

  for (const platform of BUFFER_PLATFORMS) {
    const caption = args.captions[platform];
    if (!caption) continue;

    const profile = profiles.find(
      (p) => p.service.toLowerCase() === platform || p.formatted_service?.toLowerCase().includes(platform),
    );
    if (!profile) {
      errors.push(`No Buffer profile found for ${platform}`);
      continue;
    }

    try {
      const update = await withRetry(() => createUpdate({
        token: bufferToken!,
        channelId: profile.id,
        text: caption,
        mediaUrl,
        scheduledAt: args.shareNow ? undefined : args.scheduledAt,
        shareNow: args.shareNow,
      }));

      await supabase.from('posts').insert({
        video_id: args.videoId,
        platform,
        buffer_update_id: update.id,
        scheduled_at: args.scheduledAt.toISOString(),
        status: args.shareNow ? 'published' : 'scheduled',
        caption,
      });

      results.push({ platform, externalId: update.id });
    } catch (e) {
      errors.push(`${platform}: ${String(e)}`);
      await supabase.from('posts').insert({
        video_id: args.videoId,
        platform,
        scheduled_at: args.scheduledAt.toISOString(),
        status: 'failed',
        caption,
      });
    }
  }

  // ── YouTube path — direct via Data API v3 ─────────────────────────────
  if (needsYouTube) {
    const caption = args.captions.youtube!;
    const yt = await getYouTubeConnection();
    if (!yt.connected) {
      errors.push('youtube: not connected — visit /channels to connect');
      await supabase.from('posts').insert({
        video_id: args.videoId,
        platform: 'youtube',
        scheduled_at: args.scheduledAt.toISOString(),
        status: 'failed',
        caption,
      });
    } else if (!mediaUrl) {
      errors.push('youtube: no video file to upload');
    } else {
      // Split caption into title (first line, ≤100 chars) + description (rest).
      const [firstLine, ...rest] = caption.split('\n');
      const title = firstLine.slice(0, 100);
      const description = rest.length > 0 ? rest.join('\n').trim() : caption;

      try {
        const video = await withRetry(() => uploadToYouTube({
          videoUrl: mediaUrl!,
          title,
          description,
          // shareNow → public immediately (no publishAt); otherwise private + scheduled
          publishAt: args.shareNow ? undefined : args.scheduledAt,
          thumbnailUrl: thumbUrl,
          tags: ['Torah', 'Tai Chi', 'Shorts'],
        }));

        await supabase.from('posts').insert({
          video_id: args.videoId,
          platform: 'youtube',
          buffer_update_id: video.id, // stored in shared column; renamed in UI as needed
          scheduled_at: args.scheduledAt.toISOString(),
          status: args.shareNow ? 'published' : 'scheduled',
          caption,
        });

        results.push({ platform: 'youtube', externalId: video.id });
      } catch (e) {
        errors.push(`youtube: ${String(e)}`);
        await supabase.from('posts').insert({
          video_id: args.videoId,
          platform: 'youtube',
          scheduled_at: args.scheduledAt.toISOString(),
          status: 'failed',
          caption,
        });
      }
    }
  }

  if (errors.length > 0 && results.length === 0) {
    return { error: errors.join('; ') };
  }

  return { results };
}
