import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Canonical clip plan lookup for a job.
 *
 * Only run_pipeline inserts a clip_plan row. Compose jobs and per-clip
 * regens reuse the parent's plan and never create their own. So a
 * strict `eq('job_id', X)` returns null whenever X is a compose or
 * regen — and that's the latest job for a parsha as soon as Yonah
 * iterates on clips, which is most of the time.
 *
 * This helper walks to the parsha and returns the most-recent
 * clip_plan across ANY of the parsha's jobs. The original full
 * pipeline's plan stays the source of truth for captions / full
 * script / per-platform copy across compose/regen iterations, since
 * none of that copy changes when individual clips are re-rendered.
 *
 * Use this whenever a caller needs "the canonical content for the
 * parsha this job belongs to" — captions, full_script, etc. Do NOT
 * use this when you genuinely need the per-job plan (e.g. the
 * /jobs/[id] inspector page, where showing a different parsha's
 * plan would be wrong).
 *
 * Returns the matched plan_json (or null if no plan exists for the
 * parsha at all), plus the ID of the row that holds it (so callers
 * who need to UPDATE a field — like update-caption — can target
 * the right row without a second lookup).
 */
export async function getCanonicalClipPlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  jobId: string,
): Promise<{ id: string; planJson: Record<string, unknown> } | null> {
  const { data: jobRow } = await supabase
    .from('jobs')
    .select('parsha_id, regen_of_job_id')
    .eq('id', jobId)
    .maybeSingle();
  if (!jobRow) return null;

  // Two job classes need different traversal strategies:
  //
  //   - parsha jobs: a single parsha can have many full pipeline runs
  //     (each with its own clip_plan), plus regens/composes sharing
  //     them. Search across ALL of the parsha's jobs and pick the
  //     most-recent clip_plan.
  //
  //   - topic jobs (kind='topic'): no parsha_id. Walk regen_of_job_id
  //     up to the root and look up the root's clip_plan. Topic jobs
  //     don't have sibling pipeline runs the way parsha jobs do.
  let candidateJobIds: string[] = [];
  if (jobRow.parsha_id) {
    const { data: parshaJobs } = await supabase
      .from('jobs')
      .select('id')
      .eq('parsha_id', jobRow.parsha_id);
    candidateJobIds = (parshaJobs ?? []).map((j) => j.id as string);
  } else {
    // Walk to the root via regen_of_job_id. Bounded depth (10) so a
    // pathological cycle in the data can't infinite-loop us.
    let currentId: string = jobId;
    let parentId: string | null = jobRow.regen_of_job_id ?? null;
    candidateJobIds.push(currentId);
    for (let i = 0; i < 10 && parentId; i++) {
      const { data: parent } = await supabase
        .from('jobs')
        .select('id, regen_of_job_id')
        .eq('id', parentId)
        .maybeSingle();
      if (!parent) break;
      candidateJobIds.push(parent.id as string);
      currentId = parent.id as string;
      parentId = (parent.regen_of_job_id as string | null) ?? null;
    }
  }
  if (candidateJobIds.length === 0) return null;

  const { data: planRow } = await supabase
    .from('clip_plans')
    .select('id, plan_json')
    .in('job_id', candidateJobIds)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!planRow) return null;

  return {
    id: planRow.id as string,
    planJson: (planRow.plan_json ?? {}) as Record<string, unknown>,
  };
}
