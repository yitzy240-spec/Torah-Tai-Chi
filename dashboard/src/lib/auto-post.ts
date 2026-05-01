/**
 * Shared fanout: publishes one video to Buffer (TikTok/IG/FB/X) and/or
 * YouTube direct. Extracted from `actions/schedule-all.ts` so that BOTH
 * the user-facing action AND the autopilot webhook can call the same
 * logic — autopilot has no session, so this fn must NOT touch the
 * cookie-based `createClient()`.
 *
 * Behavioural contract with scheduleAll:
 *   - Same Buffer profile lookup, same retry policy, same posts-row insert.
 *   - Same YouTube title/description split on first \n.
 *   - Same event-log taxonomy (schedule.channel.ok / schedule.channel.error).
 *   - Same return shape: { results?, error? }.
 *
 * Use the service client here because the pipeline-webhook path is
 * unauthenticated (the shared secret in the request header is the
 * trust boundary).
 */
import { createServiceClient } from '@/lib/supabase/service';
import { createUpdate, listProfiles } from '@/lib/buffer';
import { getConnection as getYouTubeConnection, uploadVideo as uploadToYouTube } from '@/lib/youtube';
import { PLATFORMS, BUFFER_PLATFORMS, type Platform } from '@/lib/platforms';
import { logEvent, type EventActor } from '@/lib/events';

function actorForPlatform(platform: Platform): EventActor {
  return platform === 'youtube' ? 'youtube' : 'buffer';
}

async function withRetry<T>(fn: () => Promise<T>, delays = [200, 1000]): Promise<T> {
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

export interface AutoPostArgs {
  videoId: string;
  scheduledAt: Date;
  /** Per-platform captions, keyed by platform name */
  captions: Partial<Record<Platform, string>>;
  /** If true, publish immediately — ignore scheduledAt. */
  shareNow?: boolean;
}

export interface AutoPostResult {
  results?: Array<{ platform: Platform; externalId: string }>;
  error?: string;
}

export async function autoPost(args: AutoPostArgs): Promise<AutoPostResult> {
  const supabase = createServiceClient();

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

  const requested = PLATFORMS.filter((p) => args.captions[p]);
  const needsBuffer = requested.some((p) => p !== 'youtube');
  const needsYouTube = requested.includes('youtube');

  // ── Buffer path — TikTok/Instagram/Facebook/X ──────────────────────────
  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;
  let profiles: Awaited<ReturnType<typeof listProfiles>> = [];
  if (needsBuffer) {
    if (!bufferToken) {
      await logEvent({
        actor: 'buffer',
        level: 'error',
        event: 'schedule.config.missing',
        subjectType: 'video',
        subjectId: args.videoId,
        message: 'BUFFER_ACCESS_TOKEN not set — autoPost cannot post to Buffer channels',
      });
      return { error: 'BUFFER_NOT_CONFIGURED' };
    }
    try {
      profiles = await withRetry(() => listProfiles(bufferToken));
    } catch (e) {
      const msg = `Failed to fetch Buffer profiles: ${String(e)}. Check Settings → Buffer.`;
      await logEvent({
        actor: 'buffer',
        level: 'error',
        event: 'schedule.topic.error',
        subjectType: 'video',
        subjectId: args.videoId,
        message: msg,
        details: { stage: 'listProfiles', error: String(e) },
      });
      return { error: msg };
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
      await logEvent({
        actor: 'buffer',
        level: 'warn',
        event: 'schedule.channel.error',
        subjectType: 'video',
        subjectId: args.videoId,
        message: `No Buffer profile found for ${platform}`,
        details: { platform },
      });
      continue;
    }

    try {
      const update = await withRetry(() => createUpdate({
        token: bufferToken!,
        channelId: profile.id,
        text: caption,
        mediaUrl,
        mediaType: 'video',
        scheduledAt: args.shareNow ? undefined : args.scheduledAt,
        shareNow: args.shareNow,
        channelService: platform,
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
      await logEvent({
        actor: actorForPlatform(platform),
        level: 'action',
        event: 'schedule.channel.ok',
        subjectType: 'video',
        subjectId: args.videoId,
        message: `Scheduled ${platform} for ${args.scheduledAt.toISOString()} (${args.shareNow ? 'shareNow' : 'queued'})`,
        details: {
          platform,
          channelId: profile.id,
          bufferId: update.id,
          scheduledAt: args.scheduledAt.toISOString(),
          shareNow: !!args.shareNow,
        },
      });
    } catch (e) {
      const errMsg = String(e);
      errors.push(`${platform}: ${errMsg}`);
      await supabase.from('posts').insert({
        video_id: args.videoId,
        platform,
        scheduled_at: args.scheduledAt.toISOString(),
        status: 'failed',
        caption,
      });
      await logEvent({
        actor: actorForPlatform(platform),
        level: 'error',
        event: 'schedule.channel.error',
        subjectType: 'video',
        subjectId: args.videoId,
        message: `Schedule failed for ${platform}: ${errMsg}`,
        details: { platform, channelId: profile.id, error: errMsg },
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
      await logEvent({
        actor: 'youtube',
        level: 'error',
        event: 'schedule.channel.error',
        subjectType: 'video',
        subjectId: args.videoId,
        message: 'YouTube not connected — skipped upload',
      });
    } else if (!mediaUrl) {
      errors.push('youtube: no video file to upload');
      await logEvent({
        actor: 'youtube',
        level: 'error',
        event: 'schedule.channel.error',
        subjectType: 'video',
        subjectId: args.videoId,
        message: 'YouTube upload skipped: no video file present',
      });
    } else {
      // Split caption into title (first line, ≤100 chars) + description (rest).
      const [firstLine, ...rest] = caption.split('\n');
      const title = firstLine.slice(0, 100);
      const description = rest.length > 0 ? rest.join('\n').trim() : caption;

      try {
        const ytVideo = await withRetry(() => uploadToYouTube({
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
          buffer_update_id: ytVideo.id,
          scheduled_at: args.scheduledAt.toISOString(),
          status: args.shareNow ? 'published' : 'scheduled',
          caption,
        });

        results.push({ platform: 'youtube', externalId: ytVideo.id });
        await logEvent({
          actor: 'youtube',
          level: 'action',
          event: 'schedule.channel.ok',
          subjectType: 'video',
          subjectId: args.videoId,
          message: `YouTube upload ${args.shareNow ? 'published' : 'scheduled'} for ${args.scheduledAt.toISOString()}`,
          details: {
            platform: 'youtube',
            youtubeVideoId: ytVideo.id,
            scheduledAt: args.scheduledAt.toISOString(),
            shareNow: !!args.shareNow,
          },
        });
      } catch (e) {
        const errMsg = String(e);
        errors.push(`youtube: ${errMsg}`);
        await supabase.from('posts').insert({
          video_id: args.videoId,
          platform: 'youtube',
          scheduled_at: args.scheduledAt.toISOString(),
          status: 'failed',
          caption,
        });
        await logEvent({
          actor: 'youtube',
          level: 'error',
          event: 'schedule.channel.error',
          subjectType: 'video',
          subjectId: args.videoId,
          message: `YouTube upload failed: ${errMsg}`,
          details: { error: errMsg },
        });
      }
    }
  }

  if (errors.length > 0 && results.length === 0) {
    await logEvent({
      actor: 'system',
      level: 'error',
      event: 'schedule.topic.error',
      subjectType: 'video',
      subjectId: args.videoId,
      message: `autoPost: all channels failed (${errors.length})`,
      details: { errors },
    });
    return { error: errors.join('; ') };
  }

  return { results };
}
