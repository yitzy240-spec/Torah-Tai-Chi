// dashboard/src/lib/page-state.ts
//
// Determines which of the 4 top-level states the page is in for a parsha.
// See spec §3 for the state model and selection rules.

export type PageState =
  | { kind: 'empty' }
  | { kind: 'draft-in-progress'; draftJobId: string | null; phase: DraftPhase }
  | { kind: 'live-at-rest'; liveVideoId: string }
  | { kind: 'live-and-draft'; liveVideoId: string; draftJobId: string | null; phase: DraftPhase };

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
  /** True when the parsha has at least one script row. A script-only
   *  parsha (no jobs / videos / posts yet) counts as a Phase 1 draft. */
  hasScripts: boolean;
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
  const { jobs, videos, posts, clipsByJobId, hasScripts } = input;

  // A live video = published to website OR has at least one published post.
  const liveVideo = videos.find((v) => {
    if (v.publishedToWebsite) return true;
    return posts.some((p) => p.videoId === v.id && p.status === 'published');
  });

  // A draft = any in-flight job, OR a done job whose video isn't yet live
  // (needs review/posting), OR a done plan-only job still awaiting clip rendering.
  //
  // clips-only is excluded from draft detection — it's a sub-action on an
  // existing plan (the operator's per-card "Generate this clip" or the
  // bottom "Generate remaining N clips" CTA), not a standalone workflow.
  // If Modal happens to write a video row for a clips-only run (single-clip
  // preview mp4 etc.), letting it count as a draft would hijack the page
  // into PlanGeneratingCard with the clips-only's elapsed time and no
  // clip_plan_id to bind to. The owning plan-only job is the canonical
  // draft for the parsha; clips-only's progress shows up through the
  // clips.storage_path realtime path on the Phase 2/3 cards.
  const isDraftKind = (k: string | null) =>
    k === null || k === 'parsha' || k === 'plan-only' || k === 'compose' || k === 'video_topic';
  const liveVideoIds = new Set(liveVideo ? [liveVideo.id] : []);

  // Cutoff: a "draft" compose/parsha must have been triggered AFTER the
  // live video's job. Without this, every previous compose attempt for
  // a parsha (e.g. v3-draft → v3-publish → v4-publish leaves v3-draft
  // forever flagged as "the unpublished draft") permanently kicks the
  // page into Phase 5 of the older draft instead of the live-at-rest
  // surface. Yonah 2026-06-02: Beha had a compose at 13:27 followed by
  // a published compose at 14:34 — the 13:27 one kept showing as the
  // current draft, so /videos/beha-alotcha?phase=5 rendered the SiteCard
  // for the older draft with isLive=false ("not yet published") even
  // though v4 was live on torahtaichi.com. Job triggered_at is the
  // right ordering signal — video.created_at would also work but jobs
  // is already on the input shape.
  const liveJobTriggeredAt = liveVideo
    ? jobs.find((j) => j.id === liveVideo.jobId)?.triggeredAt ?? null
    : null;
  const isAfterLive = (j: { triggeredAt: string }) =>
    liveJobTriggeredAt === null || j.triggeredAt > liveJobTriggeredAt;

  // Same cutoff for in-flight and plan-only-awaiting: a stale queued
  // job from before the publish point isn't a current draft. Pairs with
  // the /videos page staleness filter (2h) — that's a UI-list defense;
  // this is the parsha-state-of-the-world correctness.
  const inFlightJob = jobs.find(
    (j) => IN_FLIGHT.has(j.status) && isDraftKind(j.kind) && isAfterLive(j),
  );

  const doneUnpublished = jobs.find(
    (j) =>
      j.status === 'done' &&
      isDraftKind(j.kind) &&
      j.kind !== 'plan-only' &&
      j.videoId !== null &&
      !liveVideoIds.has(j.videoId) &&
      isAfterLive(j),
  );
  const planOnlyAwaiting = jobs.find(
    (j) => j.kind === 'plan-only' && j.status === 'done' && !j.videoId && isAfterLive(j),
  );
  const draftJob = inFlightJob ?? doneUnpublished ?? planOnlyAwaiting;

  // Script-only draft: the parsha has scripts but no job has been queued
  // yet. Tap "Start scripting" → script row inserted → land here. The
  // user edits the script in Phase 1; the job is born when they advance.
  const scriptOnlyDraft = hasScripts && !draftJob;

  if (!liveVideo && !draftJob && !scriptOnlyDraft) return { kind: 'empty' };

  if (draftJob) {
    const phase = phaseFor(draftJob, clipsByJobId[draftJob.id] ?? []);
    if (liveVideo) {
      return { kind: 'live-and-draft', liveVideoId: liveVideo.id, draftJobId: draftJob.id, phase };
    }
    return { kind: 'draft-in-progress', draftJobId: draftJob.id, phase };
  }

  if (scriptOnlyDraft) {
    if (liveVideo) {
      return { kind: 'live-and-draft', liveVideoId: liveVideo.id, draftJobId: null, phase: 1 };
    }
    return { kind: 'draft-in-progress', draftJobId: null, phase: 1 };
  }

  return { kind: 'live-at-rest', liveVideoId: liveVideo!.id };
}

function phaseFor(
  job: { status: string; kind: string | null; videoId: string | null; clipPlanId: string | null },
  clips: Array<{ storagePath: string | null }>,
): DraftPhase {
  if (job.videoId) return 4; // Stitched video exists
  // Phase 3 was retired 2026-06-01 — it was a slimmer post-stitch
  // editor that confused operators expecting the same surface as
  // Phase 2. Clips that have rendered but not yet been composed now
  // resolve to Phase 2 (the full editor with version chips), where
  // the operator can keep iterating or trigger compose.
  if (clips.length > 0 && clips.some((c) => c.storagePath)) return 2;
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
