'use server';
import { createClient } from '@/lib/supabase/server';
import { type Platform } from '@/lib/platforms';
import { autoPost } from '@/lib/auto-post';

interface ScheduleAllArgs {
  videoId: string;
  scheduledAt: Date;
  /** Per-platform captions, keyed by platform name */
  captions: Partial<Record<Platform, string>>;
  /** If true, publish immediately — ignore scheduledAt. */
  shareNow?: boolean;
}

/**
 * User-facing fanout: gate on the logged-in session, then delegate
 * to the shared `autoPost` helper which does the Buffer + YouTube work.
 * The shared helper is also used by the pipeline auto-complete webhook
 * where there is no session (it authenticates via PIPELINE_WEBHOOK_SECRET).
 */
export async function scheduleAll(
  args: ScheduleAllArgs,
): Promise<{ results?: Array<{ platform: Platform; externalId: string }>; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  return autoPost(args);
}
