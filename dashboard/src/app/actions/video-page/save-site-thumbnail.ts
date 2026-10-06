'use server';

// Uploads an operator-picked cover frame and makes it the video's
// videos.thumb_path — the image torahtaichi.com shows on the video player
// before Play is pressed, and on the video cards/carousel.
//
// Before this, thumb_path was only ever the frame auto-extracted at 20% of
// the stitched video (modal_app.py extract_thumbnail), with no way to change
// it. Yonah, 2026-10-05: "now it shows an image I really don't like on the
// website, is there a way to change that image?"
//
// thumb_path is also the cover Buffer channels and YouTube fall back to, so
// a pick here carries into future posts too (an explicit YouTube pick in
// videos.youtube_thumbnail_url still wins for YouTube).
//
// Stored at thumbnails/<videoId>-site-<timestamp>.jpg in the 'videos'
// bucket — a fresh name each pick, so the website's image URL changes and
// no CDN/browser cache keeps serving the old frame.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { revalidatePath } from 'next/cache';
import { revalidateWebsite } from '@/lib/revalidate-website';

export async function saveSiteThumbnail(
  videoId: string,
  parshaSlug: string,
  jpegBase64: string, // base64-encoded JPEG data URL or raw base64
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const supabase = createServiceClient();

  const base64 = jpegBase64.startsWith('data:')
    ? jpegBase64.split(',')[1]
    : jpegBase64;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const path = `thumbnails/${videoId}-site-${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from('videos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) return { ok: false, error: `Upload failed: ${uploadError.message}` };

  // thumb_path holds the bucket-relative path (same shape modal_app.py
  // writes), not a full URL — the website builds the URL itself.
  const { error: updateError } = await supabase
    .from('videos')
    .update({ thumb_path: path })
    .eq('id', videoId);
  if (updateError) return { ok: false, error: `Save failed: ${updateError.message}` };

  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(path);

  revalidatePath('/');
  revalidatePath(`/videos/${parshaSlug}`);

  // Bust the public website's ISR cache so the new cover shows right away
  // (the empty slug revalidates the whole site layout, which covers the
  // /videos list and carousel too). Fire-and-forget, same as
  // publishSiteChanges.
  void Promise.all([
    revalidateWebsite(`videos/${parshaSlug}`),
    revalidateWebsite(''),
  ]);

  return { ok: true, url: urlData?.publicUrl ?? '' };
}
