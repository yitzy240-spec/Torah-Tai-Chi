'use server';

// Writes one platform's caption into clip_plans.plan_json.captions.
// The flat string remains canonical for Buffer's text field.
// See spec §11.2 — must go through getCanonicalClipPlan (not a direct eq job_id lookup).
//
// Instagram captions ALSO mirror to videos.website_caption so the public
// site (torahtaichi.com) renders Yonah's latest copy. Without this mirror
// his IG edits in the new editor are phantoms on the public site —
// canonical example of the writers-and-readers-must-share-source bug
// class (MEMORY.md → feedback_writers_and_readers_must_share_source).
// Mirror behavior is preserved from the legacy update-caption.ts; that
// action will be removed in Phase 2 once captions-list.tsx is deleted.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCanonicalClipPlan } from '@/lib/clip-plan';
import { mirrorInstagramCaptionToWebsite } from '@/lib/website-caption-mirror';
import { revalidatePath } from 'next/cache';

export async function savePlatformCaption(
  jobId: string,
  platform: string,
  text: string,
  parshaSlug?: string,
): Promise<void> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const supabase = createServiceClient();
  const plan = await getCanonicalClipPlan(supabase, jobId);
  if (!plan) throw new Error('No clip plan found for job');

  // Merge the new caption into the existing captions map inside plan_json.
  const planJson = plan.planJson as Record<string, unknown>;
  const existingCaptions = (planJson.captions as Record<string, string> | undefined) ?? {};
  const updatedCaptions = { ...existingCaptions, [platform]: text };
  const updatedPlanJson = { ...planJson, captions: updatedCaptions };

  const { error } = await supabase
    .from('clip_plans')
    .update({ plan_json: updatedPlanJson })
    .eq('id', plan.id);

  if (error) throw new Error(`savePlatformCaption: ${error.message}`);

  // Mirror to videos.website_caption ONLY for the IG platform string.
  // `platform` here also carries non-platform values from youtube-card
  // (`youtube_title`, `youtube_description`) and x-card (`twitter`),
  // which must not touch website_caption. The IG-only guard is exact.
  // Mirror is best-effort: a failure logs but does not fail the save,
  // since the IG caption itself is already persisted in clip_plans and
  // the operator's next save will retry the mirror.
  if (platform === 'instagram') {
    const mirror = await mirrorInstagramCaptionToWebsite(supabase, jobId, text);
    if (!mirror.ok) {
      // TODO(phase-2-hardening): no retry / no reconcile job. If this warn
      // fires, the IG caption in clip_plans diverges from
      // videos.website_caption until Yonah edits + saves again. Two ways
      // to harden: (a) surface the failure as a non-blocking toast in the
      // posting card so the operator knows, or (b) add a periodic reconcile
      // cron that re-runs the mirror for any parsha whose clip_plans IG
      // caption differs from videos.website_caption. console.warn alone
      // means the only signal is Vercel logs nobody monitors.
      console.warn(
        `[savePlatformCaption] IG mirror to videos.website_caption failed for job ${jobId}: ${mirror.error}`,
      );
    }
  }

  // Narrow revalidation to just this video page. The previous
  // revalidatePath('/', 'layout') ran on every keystroke (EditableField
  // fires update() onChange via useOptimisticSave with NO debounce). That
  // busted the entire Next.js data cache including the unstable_cache
  // entries tagged `buffer-profiles` and `buffer-post-links`, so the
  // next render of /videos/[slug] re-fetched Buffer. Yonah's caption
  // edits were the direct cause of his recurring Buffer 24h bans (the
  // 100 calls/day limit was exceeded within minutes of typing). We
  // intentionally do NOT revalidate '/' or '/videos' here — the dashboard
  // root only needs caption-derived state on the Latest live card, which
  // is driven by videos.website_caption and ISR-refreshes on its own
  // cadence (and the explicit Publish action also revalidates root).
  if (parshaSlug) {
    revalidatePath(`/videos/${parshaSlug}`);
  }
}
