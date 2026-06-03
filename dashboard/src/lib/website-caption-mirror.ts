import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Mirror an Instagram caption onto `videos.website_caption` for every
 * `videos` row tied to the same parsha as the originating job.
 *
 * Why this exists
 * ---------------
 * The public website (torahtaichi.com) reads caption copy from
 * `videos.website_caption`. The dashboard's per-platform caption editor
 * (`save-platform-caption.ts`) writes Instagram into
 * `clip_plans.plan_json.captions.instagram` so the next post pulls the
 * latest copy. Without this mirror, Yonah's IG edits never reach the
 * public site — the writers-and-readers-must-share-source failure mode
 * (see MEMORY.md → feedback_writers_and_readers_must_share_source).
 *
 * Why fan out across the parsha
 * -----------------------------
 * A single parsha accumulates many `jobs` rows over its lifetime (full
 * pipeline → compose → per-clip regens → ad-hoc fixups). Each of those
 * jobs may have produced its own `videos` row. The public site doesn't
 * care which job's row it renders — it just wants the latest copy
 * everywhere. So we walk `jobs` by `parsha_id`, collect every job ID for
 * the parsha, and update every `videos` row whose `job_id` is in that
 * set. Behavior preserved verbatim from the legacy `update-caption.ts`
 * (lines 67-79) which Phase 2 of the stability plan will delete.
 *
 * Why Instagram only
 * ------------------
 * Per product: Instagram is the canonical long-form caption for the
 * website. Twitter is too short, YouTube is title+description (different
 * shape), Facebook is approximated from IG. Callers must gate this on
 * the platform string themselves — the helper trusts its inputs and
 * fans out unconditionally.
 *
 * Failure semantics
 * -----------------
 * Returns `{ ok: true }` on success including the no-rows-to-update
 * case (no jobs found, or no videos rows yet — both are legitimate
 * mid-pipeline states). Returns `{ ok: false, error }` only on a real
 * DB error. The caller decides whether to throw; this helper does not,
 * so the main caption save can still succeed even if the website mirror
 * fails (the IG caption itself is already persisted in `clip_plans`).
 */
export async function mirrorInstagramCaptionToWebsite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  jobId: string,
  captionText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: jobRow, error: jobErr } = await supabase
    .from('jobs')
    .select('parsha_id')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr) return { ok: false, error: `lookup job: ${jobErr.message}` };
  if (!jobRow?.parsha_id) return { ok: true }; // topic jobs, ad-hoc jobs — no parsha to fan out across

  const { data: parshaJobs, error: parshaErr } = await supabase
    .from('jobs')
    .select('id')
    .eq('parsha_id', jobRow.parsha_id);
  if (parshaErr) return { ok: false, error: `list parsha jobs: ${parshaErr.message}` };

  const allJobIds = (parshaJobs ?? []).map((j) => j.id as string);
  if (allJobIds.length === 0) return { ok: true };

  const { error: updateErr } = await supabase
    .from('videos')
    .update({ website_caption: captionText })
    .in('job_id', allJobIds);
  if (updateErr) return { ok: false, error: `update videos: ${updateErr.message}` };

  return { ok: true };
}
