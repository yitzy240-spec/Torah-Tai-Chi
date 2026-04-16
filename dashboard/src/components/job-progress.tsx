'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const STEP_LABELS: Record<string, string> = {
  queued: 'Queued',
  loading_parsha: 'Loading parsha',
  generating_plan: 'Writing the plan',
  uploading_refs: 'Uploading references',
  generating_clips: 'Generating clips',
  stitching: 'Stitching final video',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function JobProgress({ initialJob }: { initialJob: any }) {
  const [job, setJob] = useState(initialJob);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`job-${job.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${job.id}` },
        (payload) => setJob((j: any) => ({ ...j, ...payload.new })),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [job.id]);

  const done = job.status === 'done';
  const failed = job.status === 'failed';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {job.parshiot?.name}
            <Badge variant={failed ? 'destructive' : done ? 'default' : 'secondary'}>
              {STEP_LABELS[job.status] ?? job.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {job.status_message && (
            <p className="text-sm text-neutral-600">{job.status_message}</p>
          )}
          {job.error_message && (
            <pre className="rounded bg-red-50 p-3 text-xs text-red-700">{job.error_message}</pre>
          )}
          <p className="text-xs text-neutral-500">
            Cost so far: <span className="tabular-nums">${Number(job.total_cost_usd).toFixed(2)}</span>
          </p>
        </CardContent>
      </Card>

      {done && <VideoResult jobId={job.id} />}
    </div>
  );
}

function VideoResult({ jobId }: { jobId: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: video } = await supabase
        .from('videos').select('mp4_path').eq('job_id', jobId).single();
      if (!video) return;
      const { data } = supabase.storage.from('videos').getPublicUrl(video.mp4_path);
      setUrl(data.publicUrl);
    })();
  }, [jobId]);

  if (!url) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Final video</CardTitle></CardHeader>
      <CardContent>
        <video src={url} controls className="w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}
