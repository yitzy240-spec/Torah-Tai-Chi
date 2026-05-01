'use server';
import { createClient } from '@/lib/supabase/server';
import { type Platform } from '@/lib/platforms';
import { autoPost } from '@/lib/auto-post';
import { setVideoPublished } from './set-video-published';

interface ScheduleAllArgs {
  videoId: string;
  scheduledAt: Date;
  /** Per-platform captions, keyed by platform name */
  captions: Partial<Record<Platform, string>>;
  /** If true, publish immediately — ignore scheduledAt. */
  shareNow?: boolean;
  /** Optional parsha slug for revalidation when site-publish is bundled. */
  parshaSlug?: string;
  /** Channels the user opted in to. Omit to post everywhere with a caption. */
  selectedPlatforms?: readonly Platform[];
}

/**
 * User-facing fanout: gate on the logged-in session, then delegate to
 * the shared `autoPost` helper which does the Buffer + YouTube work.
 *
 * When `shareNow` is true AND the video isn't already published to the
 * site, this also flips published_to_website=true (and unpublishes any
 * sibling version of the same parsha — see set-video-published.ts).
 * The intent: "post now" should mean "this video is going public,
 * everywhere," not "social only, remember to also click the site
 * toggle." Scheduled-for-later runs leave the site toggle alone.
 *
 * Site-publish failures don't roll back the social posts. If autoPost
 * fired the social channels, those have already gone out — flagging
 * a follow-up site-publish error is the most we can do.
 */
export async function scheduleAll(
  args: ScheduleAllArgs,
): Promise<{
  results?: Array<{ platform: Platform; externalId: string }>;
  error?: string;
  /** True iff this call also flipped published_to_website true. */
  alsoPublishedToSite?: boolean;
  /** Non-fatal site-publish error message, when the social posts went
   *  out fine but site-publish failed afterwards. */
  sitePublishWarning?: string;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const result = await autoPost(args);
  if (result.error) return result;

  let alsoPublishedToSite = false;
  let sitePublishWarning: string | undefined;
  if (args.shareNow) {
    const { data: vRow } = await supabase
      .from('videos')
      .select('published_to_website')
      .eq('id', args.videoId)
      .maybeSingle();
    if (vRow && !vRow.published_to_website) {
      const sitePublish = await setVideoPublished(
        args.videoId, true, args.parshaSlug,
      );
      if (sitePublish.error) {
        sitePublishWarning = sitePublish.error;
      } else {
        alsoPublishedToSite = true;
      }
    }
  }

  return { ...result, alsoPublishedToSite, sitePublishWarning };
}
