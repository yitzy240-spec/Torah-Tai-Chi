'use server';

// Uploads a user-picked cover frame blob to Supabase Storage and persists the
// public URL to videos.youtube_thumbnail_url so it survives a page reload and
// is forwarded through Post all → autoPost.
//
// Stored at thumbnails/<videoId>-<timestamp>.jpg in the 'videos' bucket.
// Does NOT write to videos.thumb_path (that's the stitch-time auto-extracted
// thumbnail used by Buffer channels and the website hero). The persistence
// target is videos.youtube_thumbnail_url, a separate column added in
// 20260603_videos_youtube_thumbnail_url.sql.
//
// Before this column existed, the URL only lived in the YouTube card's
// local React state — reload the page and the auto-extracted thumb at
// videos.thumb_path shipped instead, silently dropping the operator's pick.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function saveYouTubeThumbnail(
  videoId: string,
  jpegBase64: string, // base64-encoded JPEG data URL or raw base64
): Promise<{ url: string }> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Service client: storage upload AND the videos-table update both go
  // through it (videos has RLS; the picker can be fired any time).
  const supabase = createServiceClient();

  // Convert base64 to Uint8Array
  const base64 = jpegBase64.startsWith('data:')
    ? jpegBase64.split(',')[1]
    : jpegBase64;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const path = `thumbnails/${videoId}-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from('videos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });

  if (uploadError) throw new Error(`saveYouTubeThumbnail upload: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(path);
  if (!urlData?.publicUrl) throw new Error('Could not get public URL for thumbnail');

  // Persist so it survives reload + feeds Post all (which reads from the
  // Phase 5 data fetch, not from the YouTube card's local state).
  const { error: updateError } = await supabase
    .from('videos')
    .update({ youtube_thumbnail_url: urlData.publicUrl })
    .eq('id', videoId);

  if (updateError) {
    throw new Error(`saveYouTubeThumbnail persist: ${updateError.message}`);
  }

  return { url: urlData.publicUrl };
}
