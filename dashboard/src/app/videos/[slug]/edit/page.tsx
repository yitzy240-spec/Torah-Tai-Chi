import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getClipVersionsByParsha } from '@/lib/clip-versions';
import { EditPageClient } from './edit-page-client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function EditClipsPage(props: PageProps) {
  const { slug } = await props.params;
  const supabase = await createClient();

  const { data: parsha } = await supabase
    .from('parshiot')
    .select('id, name')
    .eq('slug', slug)
    .single();
  if (!parsha) notFound();

  const result = await getClipVersionsByParsha(supabase, parsha.id as string);
  if (!result || result.versionsByIndex.size === 0) {
    return (
      <main className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-semibold mb-2">
          Edit clips: {parsha.name as string}
        </h1>
        <p className="text-gray-600">
          No clips have been generated yet for this parsha. Generate a
          video first, then come back here to edit individual clips.
        </p>
      </main>
    );
  }

  // The action expects a videoId. Find any video tied to the
  // representative job so submit-clip-feedback can resolve parent
  // metadata. Latest done video for the parsha is the right choice.
  const { data: videoRows } = await supabase
    .from('videos')
    .select('id, job_id, created_at')
    .eq('job_id', result.representativeJobId)
    .order('created_at', { ascending: false })
    .limit(1);
  const representativeVideoId = videoRows?.[0]?.id as string | undefined;
  if (!representativeVideoId) {
    return (
      <main className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-semibold mb-2">
          Edit clips: {parsha.name as string}
        </h1>
        <p className="text-gray-600">
          Could not locate a representative video for this parsha. Try
          again after the latest generation finishes.
        </p>
      </main>
    );
  }

  const indices = [...result.versionsByIndex.keys()].sort((a, b) => a - b);
  // Plain object for the client boundary.
  const versionsByIndex: Record<number, ReturnType<typeof toClient>[]> = {};
  for (const i of indices) {
    versionsByIndex[i] = (result.versionsByIndex.get(i) ?? []).map(toClient);
  }

  return (
    <EditPageClient
      parshaName={parsha.name as string}
      representativeJobId={result.representativeJobId}
      indices={indices}
      versionsByIndex={versionsByIndex}
      representativeVideoId={representativeVideoId}
    />
  );
}

// Identity helper that also pins the Date to ISO so server-rendered
// strings match client hydration.
function toClient(v: import('@/lib/clip-versions').ClipVersion) {
  return {
    clipId: v.clipId,
    jobId: v.jobId,
    index: v.index,
    voiceover: v.voiceover,
    visualPrompt: v.visualPrompt,
    storagePath: v.storagePath,
    createdAt: v.createdAt,
  };
}
