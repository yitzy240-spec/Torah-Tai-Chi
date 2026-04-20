'use server';

import { createClient } from '@/lib/supabase/server';
import { createUpdate, listProfiles, type BufferProfile } from '@/lib/buffer';

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
  if (!token) return { results: [], error: 'BUFFER_NOT_CONFIGURED' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { results: [], error: 'Not authenticated' };

  const text = args.text.trim();
  if (!text) return { results: [], error: 'Caption is required' };

  let profiles: BufferProfile[];
  try {
    profiles = await listProfiles(token);
  } catch (e) {
    return { results: [], error: `Buffer listProfiles: ${String(e)}` };
  }

  const selected = args.channelIds && args.channelIds.length > 0
    ? profiles.filter((p) => args.channelIds!.includes(p.id))
    : profiles;
  if (selected.length === 0) {
    return { results: [], error: 'No Buffer channels selected or connected.' };
  }

  const results: BroadcastResult[] = [];
  for (const profile of selected) {
    try {
      const update = await createUpdate({
        token,
        profileIds: [profile.id],
        text,
        mediaUrl: args.imageUrl || undefined,
        mediaType: 'image',
        shareNow: args.shareNow ?? true,
      });
      results.push({
        channel: { id: profile.id, service: profile.service, username: profile.service_username },
        ok: true,
        bufferId: update.id,
      });
    } catch (e) {
      results.push({
        channel: { id: profile.id, service: profile.service, username: profile.service_username },
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { results };
}
