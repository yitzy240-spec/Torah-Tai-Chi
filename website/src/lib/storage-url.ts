const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export function publicVideoUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/videos/${path.replace(/^\/+/, "")}`;
}

export const PLACEHOLDER_THUMB_URL = publicVideoUrl("placeholders/video_placeholder.png");
