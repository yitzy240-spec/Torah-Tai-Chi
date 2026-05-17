// dashboard/src/lib/tai-chi-moves.ts
//
// Server-side helper that returns the full Tai Chi move library. Called
// from server components (page-new.tsx) and passed down to the
// MotionPickerSheet client component. Queries the tai_chi_moves table
// directly rather than HTTP-fetching the /api/tai-chi-moves route so
// the server component gets fresh data without a loopback fetch.

import { createClient } from '@/lib/supabase/server';
import { publicVideoUrl } from '@/lib/storage-url';

export interface TaiChiMove {
  slug: string;
  english: string;
  pinyin: string | null;
  thumbVideoUrl: string | null; // resolved public URL from mp4_storage_path
}

export async function listTaiChiMoves(): Promise<TaiChiMove[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('tai_chi_moves')
    .select('slug, english, pinyin, mp4_storage_path')
    .order('english');
  return (data ?? []).map((r) => ({
    slug: r.slug as string,
    english: r.english as string,
    pinyin: (r.pinyin as string | null) ?? null,
    thumbVideoUrl: r.mp4_storage_path
      ? publicVideoUrl(r.mp4_storage_path as string)
      : null,
  }));
}
