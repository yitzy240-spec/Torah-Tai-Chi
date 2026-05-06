import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/[id] — minimal job status endpoint used by client
 * components polling for completion of an in-flight regen. Returns
 * { id, status, statusMessage, errorMessage } or 404.
 *
 * errorMessage is included so the clip card can render an actionable
 * failure (e.g. "Out of credits — top up at kie.ai") instead of the
 * generic "Re-render failed" we showed before. Truncated to 600 chars
 * because tracebacks can be long and we only need the first line or
 * two for the UI message.
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
    .select('id, status, status_message, error_message')
    .eq('id', id)
    .maybeSingle();

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    id: job.id as string,
    status: job.status as string,
    statusMessage: (job.status_message as string | null) ?? null,
    errorMessage: ((job.error_message as string | null) ?? null)?.slice(0, 600) ?? null,
  });
}
