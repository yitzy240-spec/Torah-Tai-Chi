import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/for-script?scriptId=<uuid>
 *
 * Returns the latest job for a given script plus its video (if done).
 * Used by the ScriptCard to render job-in-progress / video-ready state
 * in place of the 'Approve · generate video' button.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const scriptId = searchParams.get('scriptId');
  if (!scriptId) return NextResponse.json({ error: 'scriptId required' }, { status: 400 });

  const { data: job } = await supabase
    .from('jobs')
    .select('id, status, status_message, triggered_at, videos(id, mp4_path)')
    .eq('script_id', scriptId)
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!job) return NextResponse.json({ job: null });

  const videoRel = (job as { videos?: { id: string; mp4_path: string }[] | { id: string; mp4_path: string } | null }).videos;
  const video = Array.isArray(videoRel) ? videoRel[0] : videoRel;

  return NextResponse.json({
    job: {
      id: job.id as string,
      status: job.status as string,
      statusMessage: (job.status_message as string | null) ?? null,
      triggeredAt: job.triggered_at as string,
      videoId: video?.id ?? null,
    },
  });
}
