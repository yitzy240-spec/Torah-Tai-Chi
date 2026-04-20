/**
 * Nightly reconciliation job: flip `posts.status` from 'scheduled' to
 * 'published' for YouTube uploads once Google confirms they're live.
 *
 * Triggered by Vercel Cron (see vercel.json). Buffer-platform posts
 * (TikTok/IG/FB) are not reconciled here — check Buffer's own
 * dashboard for multi-platform status.
 *
 * Auth: Vercel Cron sets `Authorization: Bearer ${CRON_SECRET}`. If
 * CRON_SECRET is unset we refuse to run in production.
 */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAccessToken } from '@/lib/youtube';

const CRON_SECRET = process.env.CRON_SECRET;
const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';

interface YouTubeVideoStatus {
  id: string;
  status?: { privacyStatus?: string };
  snippet?: { publishedAt?: string };
}

async function fetchYouTubeStatus(
  accessToken: string,
  videoIds: string[],
): Promise<Map<string, YouTubeVideoStatus>> {
  if (videoIds.length === 0) return new Map();
  const res = await fetch(
    `${VIDEOS_ENDPOINT}?id=${videoIds.join(',')}&part=status,snippet`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`YouTube videos.list: ${res.status}`);
  const body = (await res.json()) as { items?: YouTubeVideoStatus[] };
  return new Map((body.items ?? []).map((v) => [v.id, v]));
}

export async function GET(request: Request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createServiceClient();
  const { data: pending, error } = await admin
    .from('posts')
    .select('id, platform, buffer_update_id')
    .eq('platform', 'youtube')
    .eq('status', 'scheduled')
    .not('buffer_update_id', 'is', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pending || pending.length === 0) {
    return NextResponse.json({ checked: 0, updated: 0 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    return NextResponse.json(
      { error: `YouTube not connected: ${e instanceof Error ? e.message : String(e)}` },
      { status: 503 },
    );
  }

  const videoIds = pending.map((p) => p.buffer_update_id as string);
  let statusMap: Map<string, YouTubeVideoStatus>;
  try {
    statusMap = await fetchYouTubeStatus(accessToken, videoIds);
  } catch (e) {
    return NextResponse.json(
      { error: `YouTube fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  let updated = 0;
  const missingOnYouTube: string[] = [];
  for (const post of pending) {
    const video = statusMap.get(post.buffer_update_id as string);
    if (!video) {
      missingOnYouTube.push(post.buffer_update_id as string);
      continue;
    }
    // YouTube uploads with publishAt set stay 'private' until the scheduled
    // time, then flip to 'public'. We consider a post published once it's
    // public (or unlisted — edge case).
    const privacy = video.status?.privacyStatus;
    if (privacy === 'public' || privacy === 'unlisted') {
      const { error: updErr } = await admin
        .from('posts')
        .update({
          status: 'published',
          published_at: video.snippet?.publishedAt ?? new Date().toISOString(),
          post_url: `https://www.youtube.com/watch?v=${post.buffer_update_id}`,
        })
        .eq('id', post.id);
      if (!updErr) updated++;
    }
  }

  return NextResponse.json({
    checked: pending.length,
    updated,
    missingOnYouTube: missingOnYouTube.length,
  });
}
