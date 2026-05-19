'use server';

// Single action that branches on process.env.EDITPOST_BRANCH (default 'B').
// Branch A: calls editPostBuffer on the existing post's buffer_update_id (in-place edit).
// Branch B: calls deletePostBuffer then re-creates the post; marks old posts row unposted.
// See spec §13. Default is B (delete+repost is the safe default until verification runs).

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { editPostBuffer, deletePostBuffer, createUpdate, listProfiles } from '@/lib/buffer';
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
    .select('id, buffer_update_id, scheduled_at')
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

  if (branch === 'A') {
    // Branch A: in-place edit via Buffer's editPost mutation.
    try {
      await editPostBuffer({ token: bufferToken, postId: post.buffer_update_id, text: newText });
      await supabase.from('posts').update({ caption: newText }).eq('id', post.id);
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
      text: newText,
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
      caption: newText,
    });

    revalidatePath('/', 'layout');
    return { ok: true, mode: 'reposted' };
  } catch (e) {
    return { ok: false, mode: 'reposted', error: (e as Error).message };
  }
}
