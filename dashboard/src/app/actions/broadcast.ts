'use server';

import { createClient } from '@/lib/supabase/server';
import { createUpdate, listProfiles, type BufferProfile } from '@/lib/buffer';
import { normalizeForSocials } from '@/lib/image-processing';
import { logEvent } from '@/lib/events';

export interface BroadcastArgs {
  text: string;
  imageUrl?: string;
  /** Buffer channel ids to post to. Empty = all connected channels. */
  channelIds?: string[];
  /** If true (default), publish immediately; otherwise queue. */
  shareNow?: boolean;
}

export interface BroadcastResult {
  channel: {
    id: string;
    service: string;
    username: string;
  };
  ok: boolean;
  error?: string;
  bufferId?: string;
}

/**
 * Ad-hoc broadcast to Buffer channels — used for welcome posts /
 * announcements that don't come from the weekly parsha pipeline.
 * YouTube is intentionally excluded: it requires a video file, which
 * this flow doesn't have. Use the Schedule-all flow for videos.
 */
export async function broadcast(
  args: BroadcastArgs,
): Promise<{ results: BroadcastResult[]; error?: string }> {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) {
    await logEvent({
      actor: 'buffer',
      level: 'error',
      event: 'broadcast.config.missing',
      message: 'BUFFER_ACCESS_TOKEN not set — cannot broadcast',
    });
    return { results: [], error: 'BUFFER_NOT_CONFIGURED' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { results: [], error: 'Not authenticated' };

  const text = args.text.trim();
  if (!text) return { results: [], error: 'Caption is required' };

  let profiles: BufferProfile[];
  try {
    profiles = await listProfiles(token);
  } catch (e) {
    const msg = `Buffer listProfiles: ${String(e)}`;
    await logEvent({
      actor: 'buffer',
      level: 'error',
      event: 'broadcast.topic.error',
      message: msg,
      details: { stage: 'listProfiles', error: String(e) },
    });
    return { results: [], error: msg };
  }

  const selected = args.channelIds && args.channelIds.length > 0
    ? profiles.filter((p) => args.channelIds!.includes(p.id))
    : profiles;
  if (selected.length === 0) {
    await logEvent({
      actor: 'buffer',
      level: 'warn',
      event: 'broadcast.topic.error',
      message: 'No Buffer channels selected or connected.',
      details: { requested: args.channelIds ?? [] },
    });
    return { results: [], error: 'No Buffer channels selected or connected.' };
  }

  // Normalize the image once for all channels so Buffer gets a single
  // social-safe asset (fits TikTok's pixel cap, Twitter's 5MB cap, etc).
  let normalizedImageUrl: string | undefined;
  if (args.imageUrl) {
    try {
      normalizedImageUrl = await normalizeForSocials(args.imageUrl);
    } catch (e) {
      const msg = `Image processing: ${e instanceof Error ? e.message : String(e)}`;
      await logEvent({
        actor: 'buffer',
        level: 'error',
        event: 'broadcast.topic.error',
        message: msg,
        details: { stage: 'normalizeForSocials', imageUrl: args.imageUrl, error: String(e) },
      });
      return { results: [], error: msg };
    }
  }

  const results: BroadcastResult[] = [];
  for (const profile of selected) {
    try {
      const update = await createUpdate({
        token,
        channelId: profile.id,
        text,
        mediaUrl: normalizedImageUrl,
        mediaType: 'image',
        shareNow: args.shareNow ?? true,
        channelService: profile.service,
      });
      results.push({
        channel: { id: profile.id, service: profile.service, username: profile.service_username },
        ok: true,
        bufferId: update.id,
      });
      await logEvent({
        actor: 'buffer',
        level: 'action',
        event: 'broadcast.channel.ok',
        message: `Broadcast sent to ${profile.service} (${profile.service_username})`,
        details: {
          channelId: profile.id,
          service: profile.service,
          username: profile.service_username,
          bufferId: update.id,
          shareNow: args.shareNow ?? true,
        },
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      results.push({
        channel: { id: profile.id, service: profile.service, username: profile.service_username },
        ok: false,
        error: errMsg,
      });
      await logEvent({
        actor: 'buffer',
        level: 'error',
        event: 'broadcast.channel.error',
        message: `Broadcast failed for ${profile.service} (${profile.service_username}): ${errMsg}`,
        details: {
          channelId: profile.id,
          service: profile.service,
          username: profile.service_username,
          error: errMsg,
        },
      });
    }
  }

  return { results };
}
