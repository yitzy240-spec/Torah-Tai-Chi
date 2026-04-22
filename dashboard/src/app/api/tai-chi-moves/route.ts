import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tai-chi-moves
 *
 * Returns the full tai chi reference library for the dashboard picker.
 * Ordered by section, then English name.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('tai_chi_moves')
    .select('slug, english, pinyin, section, mp4_storage_path, duration_s')
    .order('section', { ascending: true })
    .order('english', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const moves = (data ?? []).map((row) => ({
    slug: row.slug as string,
    english: row.english as string,
    pinyin: row.pinyin as string,
    section: row.section as string,
    duration_s: row.duration_s as number,
    mp4_url: `${base}/storage/v1/object/public/videos/${(row.mp4_storage_path as string).replace(/^\/+/, '')}`,
  }));

  return NextResponse.json({ moves });
}
