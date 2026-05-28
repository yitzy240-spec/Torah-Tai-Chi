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
import { getCanonicalClipPlan } from '@/lib/clip-plan';

function actorForPlatform(platform: Platform): EventActor {
  return platform === 'youtube' ? 'youtube' : 'buffer';
}

/**
 * Merge a single platform → URL entry into videos.post_urls (jsonb).
 * Best-effort: failures are logged but never throw. The public website
 * reads post_urls to show 'Watch on TikTok' / 'Watch on YouTube' / etc.
 * buttons; missing keys just hide that button.
 */
async function mergePostUrl(
  supabase: ReturnType<typeof createServiceClient>,
  videoId: string,
  platform: string,
  url: string,
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from('videos')
      .select('post_urls')
      .eq('id', videoId)
      .maybeSingle();
    const current = (row?.post_urls as Record<string, string> | null) ?? {};
    if (current[platform] === url) return; // no-op
    const next = { ...current, [platform]: url };
    await supabase
      .from('videos')
      .update({ post_urls: next })
      .eq('id', videoId);
  } catch (e) {
    console.warn(
      `[mergePostUrl] failed for ${platform} ${videoId}:`,
      (e as Error).message,
    );
  }
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
  /** Platforms the user explicitly opted in to for this post. When
   *  omitted, post to every platform that has a caption (autopilot
   *  webhooks rely on the omit-default; the dashboard sheet always
   *  passes an explicit list). */
  selectedPlatforms?: readonly Platform[];
  /** Optional operator-picked YouTube thumbnail URL (from
   *  saveYouTubeThumbnail). When set, overrides the auto-extracted
   *  thumbnail at videos.thumb_path for the YouTube upload only —
   *  Buffer-side thumbnails stay on the auto-extracted one. Without
   *  this passthrough, operator's custom frame selection in the
   *  YouTube card was a phantom (uploaded to storage but never used). */
  youtubeThumbnailUrl?: string;
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
    .select('mp4_path, thumb_path, job_id')
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

  // Operator's per-platform metadata edits live on clip_plans.
  // social_metadata: { facebook?: {type, firstComment?},
  //                    instagram?: {type, firstComment?} }
  // youtube_tags: string[]  (replaces hardcoded ['Torah','Tai Chi','Shorts']
  //                          when operator edits the YT card)
  // Fetched up front so the Buffer loop + YouTube upload both see them.
  // Before this, all three were phantom edits — the operator could save
  // them and the UI showed the saved value, but autoPost ignored them.
  let socialMetadata: Record<string, { type?: 'reel' | 'post'; firstComment?: string }> = {};
  let youtubeTags: string[] | null = null;
  if (video?.job_id) {
    const plan = await getCanonicalClipPlan(supabase, video.job_id as string);
    if (plan) {
      const { data: cpRow } = await supabase
        .from('clip_plans')
        .select('social_metadata, youtube_tags')
        .eq('id', plan.id)
        .maybeSingle();
      socialMetadata = (cpRow?.social_metadata as typeof socialMetadata | null) ?? {};
      youtubeTags = (cpRow?.youtube_tags as string[] | null) ?? null;
    }
  }

  const results: Array<{ platform: Platform; externalId: string }> = [];
  const errors: string[] = [];

  // Yonah can opt out of specific channels per-post. When
  // selectedPlatforms is undefined, post to every platform that has a
  // caption (legacy behavior — used by autopilot webhooks too).
  const selectedSet = args.selectedPlatforms
    ? new Set(args.selectedPlatforms)
    : null;
  const requested = PLATFORMS
    .filter((p) => args.captions[p])
    .filter((p) => (selectedSet ? selectedSet.has(p) : true));
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
    // Respect the user's per-post channel selection. The high-level
    // `requested` array above filters by selectedSet to decide whether
    // to load Buffer profiles AT ALL, but it never gated the actual
    // fanout loop — so if Yonah picked only TikTok, he still got
    // posts on Instagram + Twitter because they had captions and the
    // loop only checked `if (!caption) continue`. (Yonah, 2026-05-07,
    // twice tried to post to one channel and it went to all three.)
    // When selectedSet is null (autopilot webhook, no user selection)
    // the legacy "post everywhere with a caption" behavior is preserved.
    if (selectedSet && !selectedSet.has(platform)) continue;

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

    // Operator's per-platform overrides for this Buffer call.
    // facebookType: operator's Reel/Post choice from the FB card (FB
    //   default stays 'reel' for video — operator can override to 'post').
    // firstComment: auto-comment posted right after the main post; works
    //   on FB; Buffer has a known issue where IG silently drops it (we
    //   pass it anyway so it lights up the moment Buffer fixes their side).
    const platformMeta = socialMetadata[platform] ?? {};
    const facebookType = platform === 'facebook' ? platformMeta.type : undefined;
    const firstComment = platform === 'facebook' || platform === 'instagram'
      ? (platformMeta.firstComment || undefined)
      : undefined;

    try {
      const update = await withRetry(() => createUpdate({
        token: bufferToken!,
        channelId: profile.id,
        text: caption,
        mediaUrl,
        mediaType: 'video',
        facebookType,
        firstComment,
        // thumbnailUrl removed: shipping a 720×1280 PNG via
        // assets.videos[0].thumbnailUrl caused Buffer-accepted-but-
        // IG-rejected ("issue with the media attached") on Yonah's
        // 2026-05-08 10:30 UTC post (buffer_update_id 69fdbb3cb671…).
        // Meta's Reels cover_url spec wants JPG at 1080×1920; our
        // pipeline produces PNG at the source resolution (720p).
        // Add this back only after the thumbnail generator is updated
        // to output 1080×1920 JPG (separate change to modal_app.py
        // extract_thumbnail).
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
        error_message: null,
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
      const truncatedErr = (errMsg ?? '').split('\n')[0].slice(0, 1000) || null;
      await supabase.from('posts').insert({
        video_id: args.videoId,
        platform,
        scheduled_at: args.scheduledAt.toISOString(),
        status: 'failed',
        caption,
        error_message: truncatedErr,
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
      const ytNotConnectedErr = 'YouTube not connected — visit /channels to connect';
      errors.push('youtube: not connected — visit /channels to connect');
      await supabase.from('posts').insert({
        video_id: args.videoId,
        platform: 'youtube',
        scheduled_at: args.scheduledAt.toISOString(),
        status: 'failed',
        caption,
        error_message: ytNotConnectedErr.split('\n')[0].slice(0, 1000) || null,
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
      // Read youtube_title + youtube_description directly from the plan
      // so they keep their distinct semantics. Falling back to a
      // split-on-newline of `caption` swaps title/description when one
      // field is empty: the description gets sliced to 100 chars and
      // posted as the title, with hashtags alone as the description.
      // That bug happened in production for Emor. Always prefer the
      // structured fields; only fall back when no plan exists.
      const { data: vJob } = await supabase
        .from('videos').select('job_id').eq('id', args.videoId).single();
      const plan = vJob?.job_id
        ? await getCanonicalClipPlan(supabase, vJob.job_id)
        : null;
      const planCaptions = (
        (plan?.planJson as { captions?: Record<string, string> } | null)
          ?.captions ?? {}
      );
      const planTitle = (planCaptions.youtube_title ?? '').trim();
      const planDesc = (planCaptions.youtube_description ?? '').trim();

      let title: string;
      let description: string;
      if (planTitle || planDesc) {
        title = (planTitle || planDesc).slice(0, 100);
        description = planDesc || planTitle;
      } else {
        // Legacy path: no structured fields — split the flattened
        // string. Same as before.
        const [firstLine, ...rest] = caption.split('\n');
        title = firstLine.slice(0, 100);
        description = rest.length > 0 ? rest.join('\n').trim() : caption;
      }

      // Operator overrides for the YouTube upload:
      //   args.youtubeThumbnailUrl: operator's hand-picked cover frame
      //     (from saveYouTubeThumbnail). Falls back to the auto-extracted
      //     videos.thumb_path when not provided. Before this passthrough
      //     the custom thumbnail was uploaded to storage but never used.
      //   youtubeTags (from clip_plans.youtube_tags): operator-edited tag
      //     list. Falls back to ['Torah','Tai Chi','Shorts'] when the
      //     operator hasn't customized — preserves the historic default
      //     for any video predating the editable-tags UI.
      try {
        const ytVideo = await withRetry(() => uploadToYouTube({
          videoUrl: mediaUrl!,
          title,
          description,
          // shareNow → public immediately (no publishAt); otherwise private + scheduled
          publishAt: args.shareNow ? undefined : args.scheduledAt,
          thumbnailUrl: args.youtubeThumbnailUrl ?? thumbUrl,
          tags: (youtubeTags && youtubeTags.length > 0)
            ? youtubeTags
            : ['Torah', 'Tai Chi', 'Shorts'],
        }));

        const youtubeUrl = `https://youtube.com/shorts/${ytVideo.id}`;
        await supabase.from('posts').insert({
          video_id: args.videoId,
          platform: 'youtube',
          buffer_update_id: ytVideo.id,
          post_url: youtubeUrl,
          scheduled_at: args.scheduledAt.toISOString(),
          status: args.shareNow ? 'published' : 'scheduled',
          caption,
          error_message: null,
        });
        // YouTube URL is deterministic at upload time, so denormalize it
        // onto videos.post_urls immediately for the public website to use.
        await mergePostUrl(supabase, args.videoId, 'youtube', youtubeUrl);

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
        const truncatedErr = (errMsg ?? '').split('\n')[0].slice(0, 1000) || null;
        await supabase.from('posts').insert({
          video_id: args.videoId,
          platform: 'youtube',
          scheduled_at: args.scheduledAt.toISOString(),
          status: 'failed',
          caption,
          error_message: truncatedErr,
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
