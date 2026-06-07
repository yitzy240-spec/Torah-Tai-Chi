// dashboard/src/app/api/jobs/done/route.ts
//
// Modal POSTs here when a job reaches a terminal stage (done / failed /
// cancelled). We send Yonah an email so he can close the dashboard tab
// and trust the notification.
//
// Live progress does NOT go through here — Modal publishes that
// directly to Supabase Broadcast. This route is only for the
// terminal side-effect.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendJobDoneNotification } from '@/lib/email';
import { isTerminalStage } from '@/lib/job-event-types';
import type { JobEvent } from '@/lib/job-event-types';

const SHARED_SECRET = process.env.MODAL_WEBHOOK_SECRET;

export async function POST(request: Request) {
  if (!SHARED_SECRET) {
    return NextResponse.json({ error: 'MODAL_WEBHOOK_SECRET not configured' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${SHARED_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let event: JobEvent;
  try {
    event = (await request.json()) as JobEvent;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!event.jobId || !event.stage) {
    return NextResponse.json({ error: 'jobId and stage required' }, { status: 400 });
  }
  if (!isTerminalStage(event.stage)) {
    return NextResponse.json({ error: 'stage must be terminal (done/failed/cancelled)' }, { status: 400 });
  }

  // Resolve the parsha slug for the email link.
  // Use the FK alias pattern (non-inner) so topic jobs (parsha_id=null) aren't
  // filtered out before we can decide how to handle them.
  const sb = createServiceClient();
  const { data: job, error } = await sb
    .from('jobs')
    .select('id, parsha_id, parshiot:parsha_id(slug)')
    .eq('id', event.jobId)
    .maybeSingle();
  if (error || !job) {
    console.error('[jobs/done] cannot resolve job', error);
    return NextResponse.json({ ok: false, error: 'job not found' }, { status: 200 });
  }
  const parshiotRow = (job as unknown as { parshiot: { slug: string } | null }).parshiot;
  const slug = parshiotRow?.slug;
  if (!slug) {
    // Topic jobs (no parsha) don't have a slug-based URL — skip the email
    // entirely rather than sending a broken link. The DB still has the
    // result; operator can find it via /videos list.
    console.warn('[jobs/done] job has no parsha slug, skipping email', { jobId: event.jobId });
    return NextResponse.json({ ok: true, note: 'no-slug' });
  }

  await sendJobDoneNotification({
    jobId: event.jobId,
    // isTerminalStage guard above has already validated this — cast is safe.
    stage: event.stage as 'done' | 'failed' | 'cancelled',
    slug,
    message: event.message ?? null,
  });

  return NextResponse.json({ ok: true });
}
