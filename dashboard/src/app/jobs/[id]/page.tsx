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

  // Supabase generated types treat embedded relationships as possibly-error
  // shapes; the component's Job type is the source of truth for the columns
  // we actually rely on, so we cast here rather than threading a wide union
  // through every nested render.
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <JobProgress
        initialJob={job as unknown as Parameters<typeof JobProgress>[0]['initialJob']}
        initialClips={(clips ?? []) as unknown as Parameters<typeof JobProgress>[0]['initialClips']}
      />
    </div>
  );
}
