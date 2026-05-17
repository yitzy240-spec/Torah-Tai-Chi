// dashboard/src/app/videos/[slug]/page-new.tsx
//
// Redesigned video detail page (spec §3 — 4-state architecture).
// Dispatched from page.tsx when video_page_v2 flag is on or ?v2=1.
//
// Milestone 4 scope: renders Phase 1 (script editor), Phase 2
// (plan review), Phase 3 (clips), and Phase 4 (stitched video).
// Phase 5 and live states are stubbed for future milestones.

import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { selectPageState } from '@/lib/page-state';
import { listTaiChiMoves } from '@/lib/tai-chi-moves';
import { estimateSeedanceCost } from '@/lib/seedance-pricing';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';
import { buildClipPayload } from '@/lib/clip-payload';
import { BilingualHeader } from './_components/bilingual-header';
import { CompressedStepper } from './_components/compressed-stepper';
import { PersistentLiveStrip } from './_components/persistent-live-strip';
import { Phase1ScriptConnected } from './_components/phase-1-script-connected';
import { Phase2PlanReviewConnected } from './_components/phase-2-plan-review-connected';
import { Phase3ClipsConnected } from './_components/phase-3-clips-connected';
import { Phase4StitchedConnected } from './_components/phase-4-stitched-connected';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

type ScriptRow = {
  id: string;
  option: string;
  title: string | null;
  draft_text: string | null;
};

type JobRow = {
  id: string;
  status: string;
  kind: string | null;
  triggered_at: string;
  completed_at: string | null;
  regen_of_job_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  videos: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clip_plans: any;
};

export default async function VideoDetailPageNew({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();

  // 1. Fetch parsha + scripts
  const { data: parshaRaw, error: parshaErr } = await supabase
    .from('parshiot')
    .select('id, name, book, slug, hebrew_name, scripts(id, option, title, draft_text)')
    .eq('slug', slug)
    .single();

  if (parshaErr || !parshaRaw) notFound();

  const parsha = parshaRaw as {
    id: string;
    name: string;
    book: string;
    slug: string;
    hebrew_name: string | null;
    scripts: ScriptRow[];
  };

  // 2. Fetch jobs for the parsha (all statuses — page-state needs in-flight too)
  const { data: jobsRaw } = await supabase
    .from('jobs')
    .select(
      'id, status, kind, triggered_at, completed_at, regen_of_job_id, ' +
        'videos(id, published_to_website), clip_plans(id)',
    )
    .eq('parsha_id', parsha.id)
    .order('triggered_at', { ascending: false });

  const jobs = (jobsRaw ?? []) as unknown as JobRow[];

  // 3. Flatten job → video / clip_plan ids for page-state
  const jobsForState = jobs.map((j) => {
    const videoRel = j.videos;
    const v = (Array.isArray(videoRel) ? videoRel[0] : videoRel) ?? null;
    const planRel = j.clip_plans;
    const p = (Array.isArray(planRel) ? planRel[0] : planRel) ?? null;
    return {
      id: j.id,
      status: j.status,
      kind: j.kind,
      videoId: (v?.id as string | null) ?? null,
      clipPlanId: (p?.id as string | null) ?? null,
      completedAt: j.completed_at,
      triggeredAt: j.triggered_at,
    };
  });

  // 4. Fetch videos for the parsha (for live detection)
  const videoIds = jobsForState
    .map((jj) => jj.videoId)
    .filter((id): id is string => id !== null);

  let videosForState: Array<{ id: string; jobId: string; publishedToWebsite: boolean }> = [];
  if (videoIds.length > 0) {
    const { data: vRows } = await supabase
      .from('videos')
      .select('id, job_id, published_to_website')
      .in('id', videoIds);
    videosForState = (vRows ?? []).map((v) => ({
      id: v.id as string,
      jobId: v.job_id as string,
      publishedToWebsite: !!(v.published_to_website as boolean | null),
    }));
  }

  // 5. Fetch posts for live detection
  let postsForState: Array<{ videoId: string; status: string }> = [];
  if (videoIds.length > 0) {
    const { data: pRows } = await supabase
      .from('posts')
      .select('video_id, status')
      .in('video_id', videoIds);
    postsForState = (pRows ?? []).map((p) => ({
      videoId: p.video_id as string,
      status: p.status as string,
    }));
  }

  // 6. Fetch clips (by job) for phase detection
  const allJobIds = jobsForState.map((jj) => jj.id);
  const clipsByJobId: Record<string, Array<{ storagePath: string | null }>> = {};
  if (allJobIds.length > 0) {
    const { data: clipRows } = await supabase
      .from('clips')
      .select('job_id, storage_path')
      .in('job_id', allJobIds);
    for (const c of clipRows ?? []) {
      const jid = c.job_id as string;
      if (!clipsByJobId[jid]) clipsByJobId[jid] = [];
      clipsByJobId[jid].push({ storagePath: c.storage_path as string | null });
    }
  }

  // 7. Compute page state
  const state = selectPageState({
    jobs: jobsForState,
    videos: videosForState,
    posts: postsForState,
    clipsByJobId,
  });

  // ---------------------------------------------------------------------------
  // Live-strip props (live-and-draft state only)
  // ---------------------------------------------------------------------------
  let liveStripProps: React.ComponentProps<typeof PersistentLiveStrip> | null = null;
  if (state.kind === 'live-and-draft') {
    const liveVideo = videosForState.find((v) => v.id === state.liveVideoId);
    // Build platform list from published posts
    const livePosts = postsForState
      .filter((p) => p.videoId === state.liveVideoId && p.status === 'published')
      .map((p) => ({ platform: p.status, url: null }));
    const liveIdx = videosForState.findIndex((v) => v.id === state.liveVideoId) + 1;
    liveStripProps = {
      liveVersionLabel: `v${liveIdx}`,
      publishedToWebsite: liveVideo?.publishedToWebsite ?? false,
      websiteUrl: `https://torahtaichi.com/${slug}`,
      livePosts,
    };
  }

  const phase =
    state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
      ? state.phase
      : null;

  // ---------------------------------------------------------------------------
  // State: empty — stub (full impl in M6)
  // ---------------------------------------------------------------------------
  if (state.kind === 'empty') {
    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
        <BilingualHeader
          hebrewName={parsha.hebrew_name}
          book={parsha.book}
          name={parsha.name}
        />
        <p style={{ color: 'var(--ink-700)' }}>
          {parsha.name} doesn&apos;t have a video yet. The script generates automatically — review
          it, then we&apos;ll make the clips.
        </p>
        <button
          type="button"
          disabled
          style={{
            width: '100%',
            minHeight: 48,
            fontSize: 15,
            fontWeight: 500,
            background: 'var(--navy-700)',
            color: 'var(--linen-50)',
            border: 'none',
            borderRadius: 10,
            padding: 14,
            cursor: 'not-allowed',
            opacity: 0.5,
          }}
        >
          Start scripting
        </button>
        <p style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 8, textAlign: 'center' }}>
          Empty state full implementation coming in milestone 6.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Script editor
  // ---------------------------------------------------------------------------
  if (
    (state.kind === 'draft-in-progress' || state.kind === 'live-and-draft') &&
    state.phase === 1
  ) {
    const scripts = parsha.scripts;
    const defaultScript =
      scripts.find((s) => s.option === 'A-tight') ??
      scripts.find((s) => s.option === 'A') ??
      scripts[0] ??
      null;

    if (!defaultScript) {
      return (
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
          <BilingualHeader
            hebrewName={parsha.hebrew_name}
            book={parsha.book}
            name={parsha.name}
          />
          <CompressedStepper currentPhase={1} />
          <p style={{ color: 'var(--ink-500)' }}>
            Generating the script… check back in a moment.
          </p>
        </div>
      );
    }

    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
        <BilingualHeader
          hebrewName={parsha.hebrew_name}
          book={parsha.book}
          name={parsha.name}
        />
        {liveStripProps && <PersistentLiveStrip {...liveStripProps} />}
        <CompressedStepper currentPhase={1} />
        <Phase1ScriptConnected
          parshaSlug={parsha.slug}
          parshaId={parsha.id}
          scripts={scripts}
          defaultScript={defaultScript}
          scriptId={defaultScript.id}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Plan review
  // ---------------------------------------------------------------------------
  if (
    (state.kind === 'draft-in-progress' || state.kind === 'live-and-draft') &&
    state.phase === 2
  ) {
    const draftJobId =
      state.kind === 'draft-in-progress' ? state.draftJobId : state.draftJobId;
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    const clipPlanId = draftJobForState?.clipPlanId ?? null;

    // Fetch clips for the plan job
    let initialClips: Array<{
      id: string;
      index: number;
      voiceover: string;
      visual_prompt: string;
      duration_s: number | null;
      storage_path: string | null;
      motion_ref_slug: string | null;
    }> = [];

    if (draftJobId) {
      const { data: clipRows } = await supabase
        .from('clips')
        .select('id, index, voiceover, visual_prompt, duration_s, storage_path, motion_ref_slug')
        .eq('job_id', draftJobId)
        .order('index');
      initialClips = (clipRows ?? []).map((c) => ({
        id: c.id as string,
        index: c.index as number,
        voiceover: (c.voiceover as string | null) ?? '',
        visual_prompt: (c.visual_prompt as string | null) ?? '',
        duration_s: (c.duration_s as number | null) ?? null,
        storage_path: (c.storage_path as string | null) ?? null,
        motion_ref_slug: (c.motion_ref_slug as string | null) ?? null,
      }));
    }

    // Cost estimate from parent job tier
    const { data: draftJobDetails } = draftJobId
      ? await supabase
          .from('jobs')
          .select('resolution, model_tier')
          .eq('id', draftJobId)
          .single()
      : { data: null };

    const resolution = (draftJobDetails?.resolution as Resolution | null) ?? '720p';
    const modelTier = (draftJobDetails?.model_tier as ModelTier | null) ?? 'standard';
    const totalDurationS = initialClips.reduce((s, c) => s + (c.duration_s ?? 0), 0);
    const totalCostEstimateUsd =
      totalDurationS > 0 ? estimateSeedanceCost(totalDurationS, resolution, modelTier) : null;
    const tierLabel = `${resolution} ${modelTier}`;

    const moves = await listTaiChiMoves();

    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
        <BilingualHeader
          hebrewName={parsha.hebrew_name}
          book={parsha.book}
          name={parsha.name}
        />
        {liveStripProps && <PersistentLiveStrip {...liveStripProps} />}
        <CompressedStepper currentPhase={2} />
        {clipPlanId && draftJobId ? (
          <Phase2PlanReviewConnected
            parshaSlug={parsha.slug}
            jobId={draftJobId}
            clipPlanId={clipPlanId}
            initialClips={initialClips}
            totalCostEstimateUsd={totalCostEstimateUsd}
            tierLabel={tierLabel}
            moves={moves}
          />
        ) : (
          <p style={{ color: 'var(--ink-500)' }}>
            Generating clip plan… check back in a moment.
          </p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Clips
  // ---------------------------------------------------------------------------
  if (
    (state.kind === 'draft-in-progress' || state.kind === 'live-and-draft') &&
    state.phase === 3
  ) {
    const draftJobId =
      state.kind === 'draft-in-progress' ? state.draftJobId : state.draftJobId;

    // Need videoId for regenClipFromText — find the video for this draft job
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    const draftVideoId = draftJobForState?.videoId ?? null;

    // Fetch clips for this job (with created_at for version deduplication)
    let phase3Clips: Array<{
      id: string;
      index: number;
      storage_path: string | null;
      duration_s: number | null;
      voiceover: string;
      visual_prompt: string;
      motion_ref_slug: string | null;
      created_at: string;
    }> = [];

    if (draftJobId) {
      const { data: clipRows } = await supabase
        .from('clips')
        .select('id, index, storage_path, duration_s, voiceover, visual_prompt, motion_ref_slug, created_at')
        .eq('job_id', draftJobId)
        .order('index');
      phase3Clips = (clipRows ?? []).map((c) => ({
        id: c.id as string,
        index: c.index as number,
        storage_path: (c.storage_path as string | null) ?? null,
        duration_s: (c.duration_s as number | null) ?? null,
        voiceover: (c.voiceover as string | null) ?? '',
        visual_prompt: (c.visual_prompt as string | null) ?? '',
        motion_ref_slug: (c.motion_ref_slug as string | null) ?? null,
        created_at: (c.created_at as string | null) ?? new Date(0).toISOString(),
      }));
    }

    const moves = await listTaiChiMoves();

    // videoId is required for regenClipFromText. If for some reason the video
    // row doesn't exist yet (edge case: clips rendered but no compose yet),
    // we fall back to a placeholder — the action will return an error gracefully.
    if (!draftVideoId || !draftJobId) {
      return (
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
          <BilingualHeader
            hebrewName={parsha.hebrew_name}
            book={parsha.book}
            name={parsha.name}
          />
          {liveStripProps && <PersistentLiveStrip {...liveStripProps} />}
          <CompressedStepper currentPhase={3} />
          <p style={{ color: 'var(--ink-500)' }}>
            Clips are generating… check back in a moment.
          </p>
        </div>
      );
    }

    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
        <BilingualHeader
          hebrewName={parsha.hebrew_name}
          book={parsha.book}
          name={parsha.name}
        />
        {liveStripProps && <PersistentLiveStrip {...liveStripProps} />}
        <CompressedStepper currentPhase={3} />
        <Phase3ClipsConnected
          videoId={draftVideoId}
          jobId={draftJobId}
          parshaSlug={parsha.slug}
          initialClips={phase3Clips}
          moves={moves}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 4: Stitched video
  // ---------------------------------------------------------------------------
  if (
    (state.kind === 'draft-in-progress' || state.kind === 'live-and-draft') &&
    state.phase === 4
  ) {
    const draftJobId =
      state.kind === 'draft-in-progress' ? state.draftJobId : state.draftJobId;
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    const draftVideoId = draftJobForState?.videoId ?? null;

    // Fetch the video row for mp4_path + thumb_path
    let videoMp4Path: string | null = null;
    let thumbPath: string | null = null;

    if (draftVideoId) {
      const { data: vRow } = await supabase
        .from('videos')
        .select('mp4_path, thumb_path')
        .eq('id', draftVideoId)
        .single();
      videoMp4Path = (vRow?.mp4_path as string | null) ?? null;
      thumbPath = (vRow?.thumb_path as string | null) ?? null;
    }

    // Fetch the clip plan for captions + boundaries
    const clipPlanId = draftJobForState?.clipPlanId ?? null;
    let planJson: unknown = null;
    if (clipPlanId) {
      const { data: planRow } = await supabase
        .from('clip_plans')
        .select('plan_json')
        .eq('id', clipPlanId)
        .single();
      planJson = planRow?.plan_json ?? null;
    }

    // Fetch clip rows for boundary building
    let clipRowsForBoundaries: Array<{ id: string; index: number }> = [];
    if (draftJobId) {
      const { data: clipRows } = await supabase
        .from('clips')
        .select('id, index')
        .eq('job_id', draftJobId)
        .order('index');
      clipRowsForBoundaries = (clipRows ?? []).map((c) => ({
        id: c.id as string,
        index: c.index as number,
      }));
    }

    const { captionsVttDataUrl, clipBoundariesS, totalDurationS } = buildClipPayload(
      planJson,
      clipRowsForBoundaries,
    );

    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
        <BilingualHeader
          hebrewName={parsha.hebrew_name}
          book={parsha.book}
          name={parsha.name}
        />
        {liveStripProps && <PersistentLiveStrip {...liveStripProps} />}
        <CompressedStepper currentPhase={4} />
        <Phase4StitchedConnected
          videoMp4Path={videoMp4Path}
          thumbPath={thumbPath}
          captionsVttDataUrl={captionsVttDataUrl}
          clipBoundariesS={clipBoundariesS}
          totalDurationS={totalDurationS}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 5 and live states — stubs for future milestones
  // ---------------------------------------------------------------------------
  const phaseLabel =
    phase === 5
      ? 'Post (milestone 5)'
      : null;

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
      <BilingualHeader
        hebrewName={parsha.hebrew_name}
        book={parsha.book}
        name={parsha.name}
      />
      {liveStripProps && <PersistentLiveStrip {...liveStripProps} />}
      {phase && <CompressedStepper currentPhase={phase} />}
      <div
        style={{
          padding: '24px 16px',
          border: '1px solid var(--ink-100)',
          borderRadius: 10,
          textAlign: 'center',
          color: 'var(--ink-500)',
          fontSize: 14,
        }}
      >
        {state.kind === 'live-at-rest' ? (
          <>
            <strong>{parsha.name}</strong> is live.{' '}
            <span style={{ color: 'var(--ink-400)', fontSize: 12 }}>
              Live-at-rest view coming in milestone 6.
            </span>
          </>
        ) : (
          <>{phaseLabel ?? `Phase ${phase ?? '?'}`} — coming in a future milestone.</>
        )}
      </div>
    </div>
  );
}
