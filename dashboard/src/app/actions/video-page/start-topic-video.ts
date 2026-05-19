'use server';
// start-topic-video.ts
//
// Creates a new topic-kind job and queues it in the Modal pipeline.
// Topic jobs have no parsha_id / script_id — the pipeline asks Claude
// to write a Rav-Eli-voiced ~45s script from the user-supplied topic text,
// then continues with the same clip-plan → generate → stitch flow.
//
// The Modal worker branches on kind == "topic" (modal_app.py:338).
// The DB constraint allows: 'parsha', 'video_topic', 'compose'.
// We use 'video_topic' to satisfy the constraint; modal_app.py handles
// both "topic" and "video_topic" after the fix in this commit.
//
// On success: returns the job id. The caller routes to /videos/topic-<jobId>
// which the video detail dispatcher resolves via job lookup. Because topic
// jobs have no parsha, they don't live under a parshiot slug — we invent
// a synthetic slug "topic-<jobId>" that the video page can handle.
//
// NOTE: The video detail page currently resolves slugs against parshiot.
// Topic videos are out-of-scope for the video-page redesign routing
// (they will open a "generating…" state). The slug returned here is for
// future wiring — for now it's enough that the job is queued.

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function startTopicVideo(opts: {
  topic?: string;
  ideaText?: string;
}): Promise<{ ok: true; jobId: string; slug: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  // The topic text: use explicit topic, fall back to ideaText, fall back to
  // empty string (the pipeline will ask Claude to suggest one).
  const topicText = (opts.topic ?? opts.ideaText ?? '').trim();

  // Insert a job with kind='video_topic'. parsha_id and script_id are nullable
  // for topic jobs (migration 20260420_topic_jobs.sql).
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      kind: 'video_topic',
      topic: topicText || null,
      status: 'queued',
      triggered_by: user.id,
    })
    .select('id')
    .single();

  if (jobErr || !job) {
    return { ok: false, error: jobErr?.message ?? 'Could not queue job' };
  }

  const workerUrl = process.env.MODAL_WORKER_URL;
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!workerUrl) return { ok: false, error: 'MODAL_WORKER_URL not set' };
  if (!triggerSecret) return { ok: false, error: 'PIPELINE_TRIGGER_SECRET not set' };

  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
      body: JSON.stringify({ job_id: job.id }),
      // 15s ceiling covers Modal cold-start + auth round-trip with margin.
      // The worker runs async; we don't wait for completion here.
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase
        .from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', job.id);
      return { ok: false, error: String(e) };
    }
  }

  revalidatePath('/', 'layout');

  // Synthetic slug for routing: "topic-<jobId>".
  // The video detail page will need to handle this prefix to look up
  // jobs by id rather than parshiot by slug (future wiring).
  const slug = `topic-${job.id}`;
  return { ok: true, jobId: job.id as string, slug };
}
