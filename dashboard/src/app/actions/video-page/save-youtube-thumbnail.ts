'use server';

// Uploads a user-picked cover frame blob to Supabase Storage and returns the public URL.
// Stored at thumbnails/<videoId>-<timestamp>.jpg in the 'videos' bucket.
// Does NOT write to videos.thumb_path (that's the stitch-time auto-extracted thumbnail).
// The URL is stored in the YouTube card's local state for use on next YouTube post.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function saveYouTubeThumbnail(
  videoId: string,
  jpegBase64: string, // base64-encoded JPEG data URL or raw base64
): Promise<{ url: string }> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new Error('Not authenticated');

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

  return { url: urlData.publicUrl };
}
