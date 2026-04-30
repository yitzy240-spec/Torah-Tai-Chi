import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { JobProgress } from '@/components/job-progress';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from('jobs')
    .select(
      'id, status, status_message, error_message, parsha_id, script_id, ' +
      'triggered_at, completed_at, total_cost_usd, director_notes, ' +
      'parshiot!jobs_parsha_id_fkey(name, book), ' +
      'scripts(title, option)',
    )
    .eq('id', id)
    .single();

  if (!job) return notFound();

  const { data: clips } = await supabase
    .from('clips')
    .select('id, index, voiceover, status, cost_usd, mp4_path')
    .eq('job_id', id)
    .order('index');

  // Compute the "typical run" duration from the most recent successful jobs.
  // Falls back to a sensible default when there isn't enough history yet.
  const { data: doneJobs } = await supabase
    .from('jobs')
    .select('triggered_at, completed_at')
    .eq('status', 'done')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(20);
  const typicalRun = computeTypicalRun(doneJobs ?? []);

  // Supabase generated types treat embedded relationships as possibly-error
  // shapes; the component's Job type is the source of truth for the columns
  // we actually rely on, so we cast here rather than threading a wide union
  // through every nested render.
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <JobProgress
        initialJob={job as unknown as Parameters<typeof JobProgress>[0]['initialJob']}
        initialClips={(clips ?? []) as unknown as Parameters<typeof JobProgress>[0]['initialClips']}
        typicalRun={typicalRun}
      />
    </div>
  );
}

/** Returns a "p25–p75" minute range from recent done jobs, or null if not
 * enough history exists yet (caller falls back to a static hint). */
function computeTypicalRun(
  rows: { triggered_at: string | null; completed_at: string | null }[],
): { lowMin: number; highMin: number } | null {
  const durations: number[] = [];
  for (const r of rows) {
    if (!r.triggered_at || !r.completed_at) continue;
    const seconds =
      (new Date(r.completed_at).getTime() - new Date(r.triggered_at).getTime()) / 1000;
    // Sanity-bound: ignore obviously bad rows (clock skew, schema migration, etc).
    if (seconds < 30 || seconds > 60 * 60) continue;
    durations.push(seconds);
  }
  if (durations.length < 3) return null;
  durations.sort((a, b) => a - b);
  const p25 = durations[Math.floor(durations.length * 0.25)];
  const p75 = durations[Math.floor(durations.length * 0.75)];
  return {
    lowMin: Math.max(1, Math.round(p25 / 60)),
    highMin: Math.max(1, Math.round(p75 / 60)),
  };
}
