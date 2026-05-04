import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/[id] — minimal job status endpoint used by client
 * components polling for completion of an in-flight regen. Returns
 * { id, status, statusMessage } or 404.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { data: job } = await supabase
    .from('jobs')
    .select('id, status, status_message')
    .eq('id', id)
    .maybeSingle();

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    id: job.id as string,
    status: job.status as string,
    statusMessage: (job.status_message as string | null) ?? null,
  });
}
