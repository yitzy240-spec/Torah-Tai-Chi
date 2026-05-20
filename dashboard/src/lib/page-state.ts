// dashboard/src/lib/page-state.ts
//
// Determines which of the 4 top-level states the page is in for a parsha.
// See spec §3 for the state model and selection rules.

export type PageState =
  | { kind: 'empty' }
  | { kind: 'draft-in-progress'; draftJobId: string; phase: DraftPhase }
  | { kind: 'live-at-rest'; liveVideoId: string }
  | { kind: 'live-and-draft'; liveVideoId: string; draftJobId: string; phase: DraftPhase };

export type DraftPhase = 1 | 2 | 3 | 4 | 5;

export interface PageStateInput {
  jobs: Array<{
    id: string;
    status: string;
    kind: string | null;
    videoId: string | null;
    clipPlanId: string | null;
    completedAt: string | null;
    triggeredAt: string;
  }>;
  videos: Array<{ id: string; jobId: string; publishedToWebsite: boolean }>;
  posts: Array<{ videoId: string; status: string }>;
  clipsByJobId: Record<string, Array<{ storagePath: string | null }>>;
}

const IN_FLIGHT = new Set([
  'queued',
  'loading_parsha',
  'generating_plan',
  'uploading_refs',
  'generating_clips',
  'verifying',
  'stitching',
]);

export function selectPageState(input: PageStateInput): PageState {
  const { jobs, videos, posts, clipsByJobId } = input;

  // A live video = published to website OR has at least one published post.
  const liveVideo = videos.find((v) => {
    if (v.publishedToWebsite) return true;
    return posts.some((p) => p.videoId === v.id && p.status === 'published');
  });

  // A draft = any in-flight job, OR a done job whose video isn't yet live
  // (needs review/posting), OR a done plan-only job still awaiting clip rendering.
  const inFlightJob = jobs.find((j) => IN_FLIGHT.has(j.status));
  const liveVideoIds = new Set(liveVideo ? [liveVideo.id] : []);
  const doneUnpublished = jobs.find(
    (j) =>
      j.status === 'done' &&
      j.kind !== 'plan-only' &&
      j.videoId !== null &&
      !liveVideoIds.has(j.videoId),
  );
  const planOnlyAwaiting = jobs.find(
    (j) => j.kind === 'plan-only' && j.status === 'done' && !j.videoId,
  );
  const draftJob = inFlightJob ?? doneUnpublished ?? planOnlyAwaiting;

  if (!liveVideo && !draftJob) return { kind: 'empty' };

  if (draftJob) {
    const phase = phaseFor(draftJob, clipsByJobId[draftJob.id] ?? []);
    if (liveVideo) {
      return { kind: 'live-and-draft', liveVideoId: liveVideo.id, draftJobId: draftJob.id, phase };
    }
    return { kind: 'draft-in-progress', draftJobId: draftJob.id, phase };
  }

  return { kind: 'live-at-rest', liveVideoId: liveVideo!.id };
}

function phaseFor(
  job: { status: string; kind: string | null; videoId: string | null; clipPlanId: string | null },
  clips: Array<{ storagePath: string | null }>,
): DraftPhase {
  if (job.videoId) return 4; // Stitched video exists
  if (clips.length > 0 && clips.some((c) => c.storagePath)) return 3; // Some clips rendered
  // Plan-only job (queued / generating_plan / done) → Phase 2.
  // This is the "plan being generated, then reviewed" surface — clipPlanId
  // may be null while Modal is still generating; the Phase 2 UI handles that
  // with a spinner + "Clip plan being generated…" copy.
  if (job.kind === 'plan-only') return 2;
  if (
    job.clipPlanId !== null ||
    job.status === 'done' ||
    ['generating_clips', 'verifying', 'stitching'].includes(job.status)
  )
    return 2; // Plan exists (or being acted on)
  return 1; // Script only
}
