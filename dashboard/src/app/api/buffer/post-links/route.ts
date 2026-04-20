import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPostExternalLinks } from '@/lib/buffer';

export const dynamic = 'force-dynamic';

/**
 * GET /api/buffer/post-links?ids=<id1>,<id2>,…
 * Returns { links: { <bufferPostId>: <externalLink | null> } }.
 *
 * Populated once Buffer has actually published the post to the network —
 * typically seconds for Twitter, up to ~2 min for TikTok.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ links: {} });

  const ids = new URL(request.url).searchParams.get('ids')?.split(',').filter(Boolean) ?? [];
  if (ids.length === 0) return NextResponse.json({ links: {} });

  try {
    const links = await getPostExternalLinks(token, ids);
    return NextResponse.json({ links });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, links: {} }, { status: 500 });
  }
}
