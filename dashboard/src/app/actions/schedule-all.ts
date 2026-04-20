'use server';
import { createClient } from '@/lib/supabase/server';
import { createUpdate, listProfiles } from '@/lib/buffer';

const PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook'] as const;
type Platform = typeof PLATFORMS[number];

interface ScheduleAllArgs {
  videoId: string;
  scheduledAt: Date;
  /** Per-platform captions, keyed by platform name */
  captions: Partial<Record<Platform, string>>;
}

export async function scheduleAll(
  args: ScheduleAllArgs,
): Promise<{ results?: Array<{ platform: Platform; bufferId: string }>; error?: string }> {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) {
    return { error: 'BUFFER_NOT_CONFIGURED' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Fetch video URL from storage
  const { data: video } = await supabase
    .from('videos')
    .select('mp4_path')
    .eq('id', args.videoId)
    .single();

  let mediaUrl: string | undefined;
  if (video?.mp4_path) {
    const { data: urlData } = supabase.storage.from('videos').getPublicUrl(video.mp4_path);
    mediaUrl = urlData?.publicUrl;
  }

  // Get Buffer profiles
  let profiles: Awaited<ReturnType<typeof listProfiles>>;
  try {
    profiles = await listProfiles(token);
  } catch (e) {
    return { error: `Failed to fetch Buffer profiles: ${String(e)}` };
  }

  const results: Array<{ platform: Platform; bufferId: string }> = [];
  const errors: string[] = [];

  for (const platform of PLATFORMS) {
    const caption = args.captions[platform];
    if (!caption) continue;

    // Match profile by service name
    const profile = profiles.find(
      (p) => p.service.toLowerCase() === platform || p.formatted_service?.toLowerCase().includes(platform),
    );
    if (!profile) {
      errors.push(`No Buffer profile found for ${platform}`);
      continue;
    }

    try {
      const update = await createUpdate({
        token,
        profileIds: [profile.id],
        text: caption,
        mediaUrl,
        scheduledAt: args.scheduledAt,
      });

      // Persist to posts table
      await supabase.from('posts').insert({
        video_id: args.videoId,
        platform,
        buffer_update_id: update.id,
        scheduled_at: args.scheduledAt.toISOString(),
        status: 'scheduled',
        caption,
      });

      results.push({ platform, bufferId: update.id });
    } catch (e) {
      errors.push(`${platform}: ${String(e)}`);
      // Still record as failed
      await supabase.from('posts').insert({
        video_id: args.videoId,
        platform,
        scheduled_at: args.scheduledAt.toISOString(),
        status: 'failed',
        caption,
      });
    }
  }

  if (errors.length > 0 && results.length === 0) {
    return { error: errors.join('; ') };
  }

  return { results };
}
