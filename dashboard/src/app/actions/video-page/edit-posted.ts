'use server';

// Single action that branches on process.env.EDITPOST_BRANCH (default 'B').
// Branch A: calls editPostBuffer on the existing post's buffer_update_id (in-place edit).
// Branch B: calls deletePostBuffer then re-creates the post; marks old posts row unposted.
// See spec §13. Default is B (delete+repost is the safe default until verification runs).
//
// Phase 0.7: the `newText` arg from the client is treated as a LAST-RESORT
// fallback only. The 4 posting cards used to pass the stale `caption` prop
// (their parent's snapshot, not the just-edited textarea value), so Buffer's
// republish wrote the pre-edit caption back to the platform — destroying the
// user's edit and the original likes/comments. The caption typed into
// CaptionAndHashtags autosaves through savePlatformCaption on every keystroke
// (no debounce — EditableField fires update() onChange via useOptimisticSave),
// so by the time Update is clicked the canonical clip_plans row is current.
// Fallback chain: clip_plans.plan_json.captions[platform] → posts.caption
// (last-known-good) → newText (stale client snapshot). The `newText` arg is
// preserved in the signature to avoid touching the 4 call sites. If all 3
// resolve to empty/whitespace we abort before calling Buffer — empty captions
// are user-hostile and Buffer doesn't reject them cleanly.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { editPostBuffer, deletePostBuffer, createUpdate, listProfiles } from '@/lib/buffer';
import { getCanonicalClipPlan } from '@/lib/clip-plan';
import { revalidatePath } from 'next/cache';

export async function editPostedOnPlatform(
  videoId: string,
  platform: string,
  newText: string,
): Promise<{ ok: boolean; mode: 'edited' | 'reposted'; error?: string }> {
  const branch = process.env.EDITPOST_BRANCH ?? 'B';

  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, mode: 'edited', error: 'Not authenticated' };

  const supabase = createServiceClient();

  // Find the most recent published post row for this video+platform.
  const { data: post } = await supabase
    .from('posts')
    .select('id, buffer_update_id, scheduled_at, caption')
    .eq('video_id', videoId)
    .eq('platform', platform)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!post?.buffer_update_id) {
    return { ok: false, mode: 'edited', error: 'No published post found with a Buffer ID.' };
  }

  const bufferToken = process.env.BUFFER_ACCESS_TOKEN;
  if (!bufferToken) return { ok: false, mode: 'edited', error: 'BUFFER_ACCESS_TOKEN not set.' };

  // Re-fetch the canonical caption server-side. The client-supplied
  // `newText` is stale (snapshot of the parent prop, not the typed
  // textarea), so we prefer the canonical source. Fallback order:
  //   1. clip_plans.plan_json.captions[platform] (canonical, autosaved)
  //   2. post.caption (last-known-good from the published posts row)
  //   3. newText (client-passed; stale but better than empty)
  // After all 3, we still guard against an all-empty result before
  // touching Buffer — empty captions are user-hostile.
  const { data: videoForJob } = await supabase
    .from('videos')
    .select('job_id')
    .eq('id', videoId)
    .single();
  if (!videoForJob?.job_id) {
    return { ok: false, mode: 'edited', error: 'Video has no associated job.' };
  }
  const canonicalPlan = await getCanonicalClipPlan(supabase, videoForJob.job_id as string);
  const captions = (canonicalPlan?.planJson.captions as Record<string, string> | undefined) ?? {};
  const canonicalCaption = captions[platform];
  const postCaption = (post.caption as string | null | undefined) ?? '';
  let textForBuffer: string;
  if (canonicalCaption && canonicalCaption.trim().length > 0) {
    textForBuffer = canonicalCaption;
  } else if (postCaption.trim().length > 0) {
    console.warn(
      `[editPostedOnPlatform] canonical caption empty/missing for video=${videoId} platform=${platform}; ` +
        `falling back to post.caption (last-known-good).`,
    );
    textForBuffer = postCaption;
  } else {
    console.warn(
      `[editPostedOnPlatform] canonical and post.caption both empty for video=${videoId} platform=${platform}; ` +
        `falling back to client newText. This means the autosave never landed (or the plan_json key is wrong).`,
    );
    textForBuffer = newText;
  }

  // Abort-on-empty guard: if all 3 fallbacks resolved to whitespace, do
  // NOT call Buffer. Buffer doesn't reject empty captions cleanly and
  // we'd nuke the last-known-good caption on the platform.
  const trimmedText = textForBuffer.trim();
  if (!trimmedText) {
    return {
      ok: false,
      mode: 'edited',
      error: 'No caption to send — canonical, post.caption, and provided text were all empty.',
    };
  }

  if (branch === 'A') {
    // Branch A: in-place edit via Buffer's editPost mutation.
    try {
      await editPostBuffer({ token: bufferToken, postId: post.buffer_update_id, text: textForBuffer });
      await supabase.from('posts').update({ caption: textForBuffer }).eq('id', post.id);
      revalidatePath('/', 'layout');
      return { ok: true, mode: 'edited' };
    } catch (e) {
      return { ok: false, mode: 'edited', error: (e as Error).message };
    }
  }

  // Branch B (default): delete old Buffer post + create a new one + update posts table.
  try {
    // 1. Delete the old Buffer post.
    await deletePostBuffer({ token: bufferToken, postId: post.buffer_update_id });

    // 2. Find the Buffer channel for this platform.
    const profiles = await listProfiles(bufferToken);
    const profile = profiles.find(
      (p) => p.service.toLowerCase() === platform || p.formatted_service?.toLowerCase().includes(platform),
    );
    if (!profile) {
      return { ok: false, mode: 'reposted', error: `No Buffer channel connected for ${platform}.` };
    }

    // 3. Fetch the video MP4 URL for re-posting.
    const { data: videoRow } = await supabase
      .from('videos')
      .select('mp4_path, thumb_path')
      .eq('id', videoId)
      .single();
    let mediaUrl: string | undefined;
    if (videoRow?.mp4_path) {
      const { data: u } = supabase.storage.from('videos').getPublicUrl(videoRow.mp4_path as string);
      mediaUrl = u?.publicUrl;
    }

    // 4. Create the fresh post.
    const fresh = await createUpdate({
      token: bufferToken,
      channelId: profile.id,
      text: textForBuffer,
      mediaUrl,
      mediaType: 'video',
      shareNow: true,
      channelService: platform,
    });

    // 5. Mark old posts row as unposted, insert new row.
    await supabase.from('posts').update({ status: 'unposted' }).eq('id', post.id);
    await supabase.from('posts').insert({
      video_id: videoId,
      platform,
      buffer_update_id: fresh.id,
      scheduled_at: new Date().toISOString(),
      status: 'published',
      caption: textForBuffer,
    });

    revalidatePath('/', 'layout');
    return { ok: true, mode: 'reposted' };
  } catch (e) {
    return { ok: false, mode: 'reposted', error: (e as Error).message };
  }
}
