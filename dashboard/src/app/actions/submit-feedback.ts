'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Feedback flow. Yonah can leave general feedback on a video or per-clip
 * feedback tied to a specific clip. Two execution paths:
 *
 *  - Surgery (Cut 2): clipId provided AND parent's clips are all
 *    checkpointed in Storage (storage_path populated). Routes to the
 *    regen-clip Modal endpoint, which regenerates only the targeted
 *    clip and re-stitches reusing the parent's other clips. ~$0.40-1.60.
 *
 *  - Full regen (Cut 1): everything else — general feedback, OR per-clip
 *    feedback on a video generated before checkpointing (legacy parent).
 *    Triggers run_pipeline end-to-end. ~$5-12.
 *
 * Mirrors trigger-generation.ts dispatch shape (header secret + 15s
 * timeout). On dispatch failure we revert the regen job to 'failed' so the
 * UI can show retry.
 */
export async function submitFeedback(opts: {
  videoId: string;
  clipId: string | null;
  text: string;
}): Promise<{ ok: true; jobId: string } | { error: string }> {
  const { videoId, clipId } = opts;
  const text = (opts.text ?? '').trim();
  if (text.length === 0) {
    return { error: 'Please describe what felt off before submitting.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Resolve video → parent job. We need the original parameters
  // (parsha_id, script_id, motion_ref_slug, model_tier, resolution,
  // partner_parsha_id, director_notes) to start the regen with the same
  // shape as the original run.
  const { data: videoRow, error: videoErr } = await supabase
    .from('videos')
    .select('id, job_id')
    .eq('id', videoId)
    .single();
  if (videoErr || !videoRow) {
    return { error: videoErr?.message ?? 'Video not found' };
  }
  const parentJobId = videoRow.job_id as string;

  const { data: parentJobRaw, error: jobErr } = await supabase
    .from('jobs')
    .select(
      'id, parsha_id, script_id, motion_ref_slug, director_notes, ' +
      'model_tier, resolution, partner_parsha_id, kind, topic',
    )
    .eq('id', parentJobId)
    .single();
  if (jobErr || !parentJobRaw) {
    return { error: jobErr?.message ?? 'Parent job not found' };
  }
  // The supabase types choke on long select strings and infer the response
  // as GenericStringError; cast to a plain shape so we can read the fields
  // we know exist on jobs.
  const parentJob = parentJobRaw as unknown as {
    id: string;
    parsha_id: string | null;
    script_id: string | null;
    motion_ref_slug: string | null;
    director_notes: string | null;
    model_tier: string | null;
    resolution: string | null;
    partner_parsha_id: string | null;
    kind: string | null;
    topic: string | null;
  };

  // Optional: if the feedback is per-clip, pull the clip's voiceover so we
  // can quote it in director_notes. Claude's prompt then has the exact
  // phrase that triggered the complaint without forcing Yonah to retype.
  // Also pull `index` (for surgery's feedback_clip_index) and the clip's
  // own storage_path as a fast yes/no signal for whether this clip can be
  // surgically regenerated. We confirm the broader fleet of parent clips
  // separately below — one missing checkpoint forces full regen.
  let voiceover: string | null = null;
  let targetClipIndex: number | null = null;
  let targetClipHasCheckpoint = false;
  if (clipId) {
    const { data: clipRow } = await supabase
      .from('clips')
      .select('voiceover, index, storage_path')
      .eq('id', clipId)
      .maybeSingle();
    voiceover = (clipRow?.voiceover ?? null) as string | null;
    targetClipIndex = (clipRow?.index ?? null) as number | null;
    targetClipHasCheckpoint = !!(clipRow?.storage_path);
  }

  // Pull the parent's clip plan so the regen anchors on what was already
  // generated. Without this, Claude starts fresh and introduces unrelated
  // changes (e.g. roots-from-feet becomes roots-from-crotch even though
  // the feedback was about something else entirely). With it, the prompt
  // explicitly says "preserve everything not addressed by the feedback".
  const { data: parentPlanRow } = await supabase
    .from('clip_plans')
    .select('plan_json, created_at')
    .eq('job_id', parentJobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const parentPlanJson = parentPlanRow?.plan_json ?? null;

  // Surgery eligibility: requires per-clip feedback AND every parent
  // clip already checkpointed to Storage (so re-stitch can pull the
  // un-touched ones back). One missing storage_path on any parent clip
  // forces full regen — partial surgery would produce a broken video.
  // We only need the count of parent clips missing storage_path.
  let surgeryEligible = false;
  if (clipId && targetClipIndex !== null && targetClipHasCheckpoint) {
    const { count: missingCount } = await supabase
      .from('clips')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', parentJobId)
      .is('storage_path', null);
    // Eligible only if zero parent clips are un-checkpointed.
    surgeryEligible = (missingCount ?? 1) === 0;
  }

  // Insert the feedback row first so we can FK applied_to_job_id later.
  const { data: feedbackRow, error: fbErr } = await supabase
    .from('feedback')
    .insert({
      video_id: videoId,
      clip_id: clipId,
      text,
      status: 'submitted',
      created_by: user.id,
    })
    .select('id')
    .single();
  if (fbErr || !feedbackRow) {
    return { error: fbErr?.message ?? 'Could not save feedback' };
  }

  // Build merged director_notes with three sections:
  //   1. Original director_notes (if any)
  //   2. The PREVIOUS PLAN as a strict baseline — Claude must preserve
  //      every detail not directly addressed by the feedback
  //   3. The FEEDBACK with optional clip voiceover anchor
  // Without the previous-plan anchor, regen starts from a blank page and
  // unrelated details drift (clip ordering, props, character actions
  // shift even though feedback didn't mention them). With it, the
  // prompt has explicit "this is what was already generated, only
  // change what feedback addresses" framing.
  const original = (parentJob.director_notes ?? '').toString().trim();
  const feedbackBlock = voiceover
    ? `Feedback about this section: "${voiceover.trim()}"\n${text}`
    : text;
  const previousPlanBlock = parentPlanJson
    ? `\n\nPREVIOUS VERSION PLAN (preserve everything below unless directly contradicted by the feedback. Do NOT introduce new visual elements, change clip ordering, rewrite voiceovers, or shift props that the feedback does not mention. Treat this as the baseline you are editing, not regenerating from scratch):\n${JSON.stringify(parentPlanJson, null, 2)}`
    : '';
  const feedbackSection = `\n\nFEEDBACK ON PREVIOUS VERSION (apply this and only this):\n${feedbackBlock}`;
  const merged = (original + previousPlanBlock + feedbackSection).trim();

  // Insert the new (regen) job with all the original parameters and the
  // version-chain pointer. feedback_clip_index is set ONLY on the
  // surgery path — full regen leaves it null (the column was added by
  // 20260430_clip_checkpoint.sql).
  const regenInsert: Record<string, unknown> = {
    parsha_id: parentJob.parsha_id,
    script_id: parentJob.script_id,
    partner_parsha_id: parentJob.partner_parsha_id ?? null,
    kind: parentJob.kind ?? 'parsha',
    topic: parentJob.topic ?? null,
    motion_ref_slug: parentJob.motion_ref_slug ?? null,
    resolution: parentJob.resolution ?? '720p',
    model_tier: parentJob.model_tier ?? 'standard',
    director_notes: merged,
    regen_of_job_id: parentJobId,
    status: 'queued',
    triggered_by: user.id,
  };
  if (surgeryEligible && targetClipIndex !== null) {
    regenInsert.feedback_clip_index = targetClipIndex;
  }
  const { data: regenJob, error: regenErr } = await supabase
    .from('jobs')
    .insert(regenInsert)
    .select('id')
    .single();
  if (regenErr || !regenJob) {
    // Best-effort rollback of the feedback row's status so it doesn't sit
    // in 'submitted' forever pointing at nothing.
    await supabase
      .from('feedback')
      .update({ status: 'rejected' })
      .eq('id', feedbackRow.id);
    return { error: regenErr?.message ?? 'Could not queue regen' };
  }

  // Link feedback → regen job, flip to processing.
  await supabase
    .from('feedback')
    .update({ applied_to_job_id: regenJob.id, status: 'processing' })
    .eq('id', feedbackRow.id);

  // Fire-and-forget Modal worker. Same shape as trigger-generation.ts.
  const baseTriggerUrl = process.env.MODAL_WORKER_URL;
  if (!baseTriggerUrl) {
    await supabase.from('jobs')
      .update({ status: 'failed', error_message: 'MODAL_WORKER_URL not set' })
      .eq('id', regenJob.id);
    return { error: 'MODAL_WORKER_URL not set' };
  }
  const triggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  if (!triggerSecret) {
    await supabase.from('jobs')
      .update({ status: 'failed', error_message: 'PIPELINE_TRIGGER_SECRET not set' })
      .eq('id', regenJob.id);
    return { error: 'PIPELINE_TRIGGER_SECRET not set' };
  }
  // Surgery hits a different Modal endpoint. Modal's URL pattern is
  // <account>--<app>-<function>.modal.run; the trigger function is
  // 'pipeline-trigger', the surgery endpoint is 'pipeline-regen-clip-endpoint'.
  // We string-replace rather than carry a second env var so deployments
  // don't need a paired config update.
  const workerUrl = surgeryEligible
    ? baseTriggerUrl.replace('pipeline-trigger', 'pipeline-regen-clip-endpoint')
    : baseTriggerUrl;
  try {
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pipeline-secret': triggerSecret,
      },
      body: JSON.stringify({ job_id: regenJob.id }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if ((e as Error).name !== 'TimeoutError' && (e as Error).name !== 'AbortError') {
      await supabase
        .from('jobs')
        .update({ status: 'failed', error_message: String(e) })
        .eq('id', regenJob.id);
      return { error: String(e) };
    }
  }

  // We don't know the parsha slug here without another round-trip; the
  // /videos route revalidates list views. The detail page revalidation
  // happens via the /videos/[slug] path the caller is on (server action
  // returns to that page; Next will re-run the loader on the redirect
  // target if relevant). We also revalidate the new job's progress page.
  revalidatePath('/videos');
  revalidatePath(`/jobs/${regenJob.id}`);

  return { ok: true, jobId: regenJob.id as string };
}
