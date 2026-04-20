import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { JobProgress } from '@/components/job-progress';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from('jobs')
    .select('id, status, status_message, parsha_id, script_id, triggered_at, total_cost_usd, parshiot(name, book)')
    .eq('id', id).single();

  if (!job) return notFound();

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <JobProgress initialJob={job} />
    </div>
  );
}
