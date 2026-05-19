// dashboard/src/app/videos/[slug]/page-new.tsx
//
// Redesigned video detail page (spec §3 — 4-state architecture).
// Dispatched from page.tsx when video_page_v2 flag is on or ?v2=1.
//
// Milestone 6 wires all four top-level states:
//   empty           → EmptyState
//   draft-in-progress → 5-phase stepper (M3-M5)
//   live-at-rest    → LiveAtRest (M6)
//   live-and-draft  → DraftCalloutStrip + LiveAtRest (landing) or draft phase (continue=1)
//
// Milestone 7 (perf):
//   - Shell data (parsha + jobs + state) fetched in 2 serial steps; steps 3-5
//     (videos, posts, clips) run in parallel after jobs resolves.
//   - Per-phase data fetches moved into <PhaseBody> (async server component) so
//     the shell (header + live-strip + stepper) reaches the client on first paint
//     while body streams in via <Suspense>.
//   - <PhaseSkeleton> provides a minimal placeholder while body loads.

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { selectPageState } from '@/lib/page-state';
import type { DraftPhase, PageState } from '@/lib/page-state';
import { listTaiChiMoves } from '@/lib/tai-chi-moves';
import { estimateSeedanceCost } from '@/lib/seedance-pricing';
import type { Resolution, ModelTier } from '@/lib/seedance-pricing';
import { buildClipPayload } from '@/lib/clip-payload';
import { getCanonicalClipPlan } from '@/lib/clip-plan';
import { getConnectedPlatforms } from '@/lib/connected-platforms';
import { BilingualHeader } from './_components/bilingual-header';
import { CompressedStepper } from './_components/compressed-stepper';
import { PersistentLiveStrip } from './_components/persistent-live-strip';
import { Phase1ScriptConnected } from './_components/phase-1-script-connected';
import { Phase2PlanReviewConnected } from './_components/phase-2-plan-review-connected';
import { Phase3ClipsConnected } from './_components/phase-3-clips-connected';
import { Phase4StitchedConnected } from './_components/phase-4-stitched-connected';
import { Phase5PostConnected } from './_components/phase-5-post-connected';
import { EmptyState } from './_components/empty-state';
import { LiveAtRestConnected } from './_components/live-at-rest-connected';
import type { PlatformStatus } from './_components/live-at-rest';
import { DraftCalloutStrip } from './_components/draft-callout-strip';

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

// ---------------------------------------------------------------------------
// Shell data — fetched before the Suspense boundary so the header + stepper
// paint immediately. Two serial round-trips:
//   1. parsha (slug → row + scripts)
//   2. jobs + derived (videos, posts, clips) — the latter three run in parallel
// ---------------------------------------------------------------------------

type ShellData = {
  parsha: {
    id: string;
    name: string;
    book: string;
    slug: string;
    hebrew_name: string | null;
    scripts: ScriptRow[];
  };
  state: PageState;
  videosForState: Array<{ id: string; jobId: string; publishedToWebsite: boolean }>;
  postsForState: Array<{ videoId: string; status: string }>;
  jobsForState: Array<{
    id: string;
    status: string;
    kind: string | null;
    videoId: string | null;
    clipPlanId: string | null;
    completedAt: string | null;
    triggeredAt: string;
  }>;
  clipsByJobId: Record<string, Array<{ storagePath: string | null }>>;
  liveStripProps: React.ComponentProps<typeof PersistentLiveStrip> | null;
  phase: DraftPhase | null;
  statePhase: DraftPhase | null;
  showDraftView: boolean;
};

async function fetchPageShellData(
  slug: string,
  continueParam: boolean,
  phaseParam: DraftPhase | null,
): Promise<ShellData | null> {
  const supabase = await createClient();

  // Step 1: parsha + scripts (must be first — slug → parsha.id)
  const { data: parshaRaw, error: parshaErr } = await supabase
    .from('parshiot')
    .select('id, name, book, slug, hebrew_name, scripts(id, option, title, draft_text)')
    .eq('slug', slug)
    .single();

  if (parshaErr || !parshaRaw) return null;

  const parsha = parshaRaw as {
    id: string;
    name: string;
    book: string;
    slug: string;
    hebrew_name: string | null;
    scripts: ScriptRow[];
  };

  // Step 2a: jobs (needs parsha.id; must complete before we can derive videoIds/jobIds)
  const { data: jobsRaw } = await supabase
    .from('jobs')
    .select(
      'id, status, kind, triggered_at, completed_at, regen_of_job_id, ' +
        'videos(id, published_to_website), clip_plans(id)',
    )
    .eq('parsha_id', parsha.id)
    .order('triggered_at', { ascending: false });

  const jobs = (jobsRaw ?? []) as unknown as JobRow[];

  // Flatten job → video / clip_plan ids
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

  const videoIds = jobsForState
    .map((jj) => jj.videoId)
    .filter((id): id is string => id !== null);
  const allJobIds = jobsForState.map((jj) => jj.id);

  // Step 2b-d: videos + posts + clips — all independent; run in parallel.
  const [videosResult, postsResult, clipsResult] = await Promise.all([
    videoIds.length > 0
      ? supabase.from('videos').select('id, job_id, published_to_website').in('id', videoIds)
      : Promise.resolve({ data: [] }),
    videoIds.length > 0
      ? supabase.from('posts').select('video_id, status').in('video_id', videoIds)
      : Promise.resolve({ data: [] }),
    allJobIds.length > 0
      ? supabase.from('clips').select('job_id, storage_path').in('job_id', allJobIds)
      : Promise.resolve({ data: [] }),
  ]);

  const videosForState: Array<{ id: string; jobId: string; publishedToWebsite: boolean }> = (
    videosResult.data ?? []
  ).map((v) => ({
    id: v.id as string,
    jobId: v.job_id as string,
    publishedToWebsite: !!(v.published_to_website as boolean | null),
  }));

  const postsForState: Array<{ videoId: string; status: string }> = (postsResult.data ?? []).map(
    (p) => ({
      videoId: p.video_id as string,
      status: p.status as string,
    }),
  );

  const clipsByJobId: Record<string, Array<{ storagePath: string | null }>> = {};
  for (const c of clipsResult.data ?? []) {
    const jid = c.job_id as string;
    if (!clipsByJobId[jid]) clipsByJobId[jid] = [];
    clipsByJobId[jid].push({ storagePath: c.storage_path as string | null });
  }

  // Compute page state (pure)
  const state = selectPageState({
    jobs: jobsForState,
    videos: videosForState,
    posts: postsForState,
    clipsByJobId,
  });

  // Live-strip props (live-and-draft state only)
  let liveStripProps: React.ComponentProps<typeof PersistentLiveStrip> | null = null;
  if (state.kind === 'live-and-draft') {
    const liveVideo = videosForState.find((v) => v.id === state.liveVideoId);
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

  const statePhase =
    state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
      ? state.phase
      : null;
  const phase = phaseParam ?? statePhase;

  const showDraftView =
    state.kind === 'draft-in-progress' ||
    (state.kind === 'live-and-draft' && (continueParam || phaseParam !== null));

  return {
    parsha,
    state,
    videosForState,
    postsForState,
    jobsForState,
    clipsByJobId,
    liveStripProps,
    phase,
    statePhase,
    showDraftView,
  };
}

// ---------------------------------------------------------------------------
// PhaseSkeleton — minimal grey placeholder while PhaseBody streams in.
// Matches the visual shape of each phase (spec §8.3).
// ---------------------------------------------------------------------------

function PhaseSkeleton({ phase }: { phase: DraftPhase | null }) {
  // For live/empty states this won't render (no Suspense wrapper there),
  // but keep it safe for any phase value.
  const cardCount =
    phase === 1
      ? 1 // single textarea
      : phase === 2 || phase === 3
        ? 3 // 3 clip cards
        : phase === 4
          ? 1 // video player
          : phase === 5
            ? 5 // 5 platform cards
            : 2; // fallback

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}
      aria-busy="true"
      aria-label="Loading…"
    >
      {Array.from({ length: cardCount }).map((_, i) => (
        <div
          key={i}
          style={{
            background: 'var(--linen-100)',
            borderRadius: 'var(--r-md)',
            height: phase === 1 ? 160 : phase === 4 ? 320 : 100,
            animation: 'pulse-navy 1.8s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseBody — async server component that does all per-phase data fetches.
// Renders inside <Suspense> so the shell paints first.
// ---------------------------------------------------------------------------

async function PhaseBody({
  slug,
  phase,
  showDraftView,
  state,
  parsha,
  jobsForState,
  videosForState,
  postsForState,
  clipsByJobId,
  liveStripProps,
  statePhase,
}: {
  slug: string;
  phase: DraftPhase | null;
  showDraftView: boolean;
  state: PageState;
  parsha: ShellData['parsha'];
  jobsForState: ShellData['jobsForState'];
  videosForState: ShellData['videosForState'];
  postsForState: ShellData['postsForState'];
  clipsByJobId: ShellData['clipsByJobId'];
  liveStripProps: ShellData['liveStripProps'];
  statePhase: DraftPhase | null;
}) {
  const supabase = await createClient();

  // -------------------------------------------------------------------------
  // State: empty
  // -------------------------------------------------------------------------
  if (state.kind === 'empty') {
    return (
      <EmptyState
        parshaName={parsha.name}
        parshaId={parsha.id}
        parshaSlug={parsha.slug}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Phase 1: Script editor
  // -------------------------------------------------------------------------
  if (showDraftView && phase === 1) {
    const scripts = parsha.scripts;
    const defaultScript =
      scripts.find((s) => s.option === 'A-tight') ??
      scripts.find((s) => s.option === 'A') ??
      scripts[0] ??
      null;

    if (!defaultScript) {
      return (
        <p style={{ color: 'var(--ink-500)' }}>
          Generating the script… check back in a moment.
        </p>
      );
    }

    return (
      <Phase1ScriptConnected
        parshaSlug={parsha.slug}
        parshaId={parsha.id}
        scripts={scripts}
        defaultScript={defaultScript}
        scriptId={defaultScript.id}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Phase 2: Plan review
  // -------------------------------------------------------------------------
  if (showDraftView && phase === 2) {
    const draftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    const clipPlanId = draftJobForState?.clipPlanId ?? null;

    // Parallelize: clips + job details (resolution/tier) + tai-chi moves — all independent
    const [clipsResult, jobDetailsResult, moves] = await Promise.all([
      draftJobId
        ? supabase
            .from('clips')
            .select('id, index, voiceover, visual_prompt, duration_s, storage_path, motion_ref_slug')
            .eq('job_id', draftJobId)
            .order('index')
        : Promise.resolve({ data: [] }),
      draftJobId
        ? supabase.from('jobs').select('resolution, model_tier').eq('id', draftJobId).single()
        : Promise.resolve({ data: null }),
      listTaiChiMoves(),
    ]);

    type Phase2Clip = {
      id: string;
      index: number;
      voiceover: string;
      visual_prompt: string;
      duration_s: number | null;
      storage_path: string | null;
      motion_ref_slug: string | null;
    };

    const initialClips: Phase2Clip[] = (clipsResult.data ?? []).map((c) => ({
      id: c.id as string,
      index: c.index as number,
      voiceover: (c.voiceover as string | null) ?? '',
      visual_prompt: (c.visual_prompt as string | null) ?? '',
      duration_s: (c.duration_s as number | null) ?? null,
      storage_path: (c.storage_path as string | null) ?? null,
      motion_ref_slug: (c.motion_ref_slug as string | null) ?? null,
    }));

    const draftJobDetails = jobDetailsResult.data;
    const resolution = (draftJobDetails?.resolution as Resolution | null) ?? '720p';
    const modelTier = (draftJobDetails?.model_tier as ModelTier | null) ?? 'standard';
    const totalDurationS = initialClips.reduce((s, c) => s + (c.duration_s ?? 0), 0);
    const totalCostEstimateUsd =
      totalDurationS > 0 ? estimateSeedanceCost(totalDurationS, resolution, modelTier) : null;
    const tierLabel = `${resolution} ${modelTier}`;

    return clipPlanId && draftJobId ? (
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
    );
  }

  // -------------------------------------------------------------------------
  // Phase 3: Clips
  // -------------------------------------------------------------------------
  if (showDraftView && phase === 3) {
    const draftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    const draftVideoId = draftJobForState?.videoId ?? null;

    if (!draftVideoId || !draftJobId) {
      return (
        <p style={{ color: 'var(--ink-500)' }}>
          Clips are generating… check back in a moment.
        </p>
      );
    }

    // Parallelize: clips + moves — independent
    const [clipsResult, moves] = await Promise.all([
      supabase
        .from('clips')
        .select('id, index, storage_path, duration_s, voiceover, visual_prompt, motion_ref_slug, created_at')
        .eq('job_id', draftJobId)
        .order('index'),
      listTaiChiMoves(),
    ]);

    const phase3Clips = (clipsResult.data ?? []).map((c) => ({
      id: c.id as string,
      index: c.index as number,
      storage_path: (c.storage_path as string | null) ?? null,
      duration_s: (c.duration_s as number | null) ?? null,
      voiceover: (c.voiceover as string | null) ?? '',
      visual_prompt: (c.visual_prompt as string | null) ?? '',
      motion_ref_slug: (c.motion_ref_slug as string | null) ?? null,
      created_at: (c.created_at as string | null) ?? new Date(0).toISOString(),
    }));

    return (
      <Phase3ClipsConnected
        videoId={draftVideoId}
        jobId={draftJobId}
        parshaSlug={parsha.slug}
        initialClips={phase3Clips}
        moves={moves}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Phase 4: Stitched video
  // -------------------------------------------------------------------------
  if (showDraftView && phase === 4) {
    const draftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    const draftVideoId = draftJobForState?.videoId ?? null;
    const clipPlanId = draftJobForState?.clipPlanId ?? null;

    // Parallelize: video row + clip plan + clip rows — all independent given draftJobId/draftVideoId
    const [videoResult, planResult, clipsResult] = await Promise.all([
      draftVideoId
        ? supabase.from('videos').select('mp4_path, thumb_path').eq('id', draftVideoId).single()
        : Promise.resolve({ data: null }),
      clipPlanId
        ? supabase.from('clip_plans').select('plan_json').eq('id', clipPlanId).single()
        : Promise.resolve({ data: null }),
      draftJobId
        ? supabase.from('clips').select('id, index').eq('job_id', draftJobId).order('index')
        : Promise.resolve({ data: [] }),
    ]);

    const videoMp4Path = (videoResult.data?.mp4_path as string | null) ?? null;
    const thumbPath = (videoResult.data?.thumb_path as string | null) ?? null;
    const planJson = planResult.data?.plan_json ?? null;
    const clipRowsForBoundaries: Array<{ id: string; index: number }> = (clipsResult.data ?? []).map(
      (c) => ({
        id: c.id as string,
        index: c.index as number,
      }),
    );

    const { captionsVttDataUrl, clipBoundariesS, totalDurationS } = buildClipPayload(
      planJson,
      clipRowsForBoundaries,
    );

    return (
      <Phase4StitchedConnected
        videoMp4Path={videoMp4Path}
        thumbPath={thumbPath}
        captionsVttDataUrl={captionsVttDataUrl}
        clipBoundariesS={clipBoundariesS}
        totalDurationS={totalDurationS}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Phase 5: Posting
  // -------------------------------------------------------------------------
  if (showDraftView && phase === 5) {
    const draftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    const draftVideoId = draftJobForState?.videoId ?? null;

    const supabaseSvc = createServiceClient();

    // Parallelize: video row + canonical plan + posts + connected platforms + script_id.
    // canonical plan is needed before we can fetch clip_plan meta (plan id dependency),
    // so we split into two waves:
    //   Wave A: video row + canonical plan + posts + connected platforms + job script_id
    //   Wave B: clip_plan meta (needs canonical plan id from Wave A)
    const [videoResult, canonicalPlan, postsResult, connectedPlatforms, jobDetailResult] =
      await Promise.all([
        draftVideoId
          ? supabase
              .from('videos')
              .select(
                'id, mp4_path, thumb_path, title, subtitle, description, published_to_website, post_urls',
              )
              .eq('id', draftVideoId)
              .single()
          : Promise.resolve({ data: null }),
        draftJobId ? getCanonicalClipPlan(supabaseSvc, draftJobId) : Promise.resolve(null),
        draftVideoId
          ? supabase
              .from('posts')
              .select('id, platform, status, created_at, scheduled_at, buffer_update_id, caption')
              .eq('video_id', draftVideoId)
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] }),
        getConnectedPlatforms(),
        draftJobId
          ? supabase.from('jobs').select('script_id').eq('id', draftJobId).single()
          : Promise.resolve({ data: null }),
      ]);

    // Wave B: clip plan meta (social_metadata + youtube_tags live outside plan_json)
    let clipPlanMeta: {
      social_metadata: Record<string, unknown> | null;
      youtube_tags: string[];
    } = { social_metadata: null, youtube_tags: [] };
    if (canonicalPlan) {
      const { data: cpRow } = await supabase
        .from('clip_plans')
        .select('social_metadata, youtube_tags')
        .eq('id', canonicalPlan.id)
        .maybeSingle();
      clipPlanMeta = {
        social_metadata: (cpRow?.social_metadata as Record<string, unknown> | null) ?? null,
        youtube_tags: (cpRow?.youtube_tags as string[] | null) ?? [],
      };
    }

    const vRow = videoResult.data;
    const videoRow = vRow
      ? {
          id: vRow.id as string,
          mp4_path: (vRow.mp4_path as string | null) ?? null,
          thumb_path: (vRow.thumb_path as string | null) ?? null,
          title: (vRow.title as string | null) ?? null,
          subtitle: (vRow.subtitle as string | null) ?? null,
          description: (vRow.description as string | null) ?? null,
          published_to_website: !!(vRow.published_to_website as boolean | null),
          post_urls: (vRow.post_urls as Record<string, string> | null) ?? null,
        }
      : null;

    const planJson = ((canonicalPlan?.planJson ?? {}) as Record<string, unknown>);
    const captions = (planJson.captions as Record<string, string> | undefined) ?? {};

    const initialPosts = (postsResult.data ?? []).map((p) => ({
      id: p.id as string,
      platform: p.platform as string,
      status: p.status as string,
      created_at: (p.created_at as string | null) ?? new Date(0).toISOString(),
      scheduled_at: (p.scheduled_at as string | null) ?? null,
      buffer_update_id: (p.buffer_update_id as string | null) ?? null,
      caption: (p.caption as string | null) ?? null,
    }));

    const draftScriptId = (jobDetailResult.data?.script_id as string | null) ?? null;

    // Public storage URLs (sync — no network; just URL construction)
    let videoMp4Url: string | null = null;
    let thumbPublicUrl: string | null = null;
    if (videoRow?.mp4_path) {
      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(videoRow.mp4_path);
      videoMp4Url = urlData?.publicUrl ?? null;
    }
    if (videoRow?.thumb_path) {
      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(videoRow.thumb_path);
      thumbPublicUrl = urlData?.publicUrl ?? null;
    }

    const siteIsLive = videoRow?.published_to_website ?? false;
    const liveSince = siteIsLive ? null : null; // TODO: surface actual published_at when added
    const liveVideoIndex = videosForState.findIndex((v) => v.id === draftVideoId) + 1;
    const liveVersionLabel = siteIsLive ? `v${liveVideoIndex}` : null;

    return (
      <Phase5PostConnected
        videoId={draftVideoId ?? ''}
        parshaSlug={parsha.slug}
        parshaId={parsha.id}
        sourceScriptId={draftScriptId ?? ''}
        isLive={siteIsLive}
        liveSince={liveSince}
        liveVersionLabel={liveVersionLabel}
        siteTitle={videoRow?.title ?? parsha.name}
        siteSubtitle={videoRow?.subtitle ?? ''}
        siteDescription={videoRow?.description ?? ''}
        websiteUrl={`https://torahtaichi.com/${parsha.slug}`}
        jobId={draftJobId ?? ''}
        captions={captions}
        youtubeTags={clipPlanMeta.youtube_tags}
        socialMetadata={
          clipPlanMeta.social_metadata as {
            instagram?: { type: 'reel' | 'post'; firstComment?: string };
            facebook?: { type: 'reel' | 'post'; firstComment?: string };
          } | null
        }
        initialPosts={initialPosts}
        postUrls={(videoRow?.post_urls ?? {}) as Record<string, string>}
        connectedPlatforms={connectedPlatforms}
        videoMp4Url={videoMp4Url}
        thumbPath={thumbPublicUrl}
      />
    );
  }

  // -------------------------------------------------------------------------
  // State: live-at-rest or live-and-draft landing
  // -------------------------------------------------------------------------
  if (state.kind === 'live-at-rest' || state.kind === 'live-and-draft') {
    const liveVideoId =
      state.kind === 'live-at-rest' ? state.liveVideoId : state.liveVideoId;

    // Parallelize: live video row + live posts — independent
    const [liveVRowResult, livePostsResult] = await Promise.all([
      supabase
        .from('videos')
        .select('id, mp4_path, thumb_path, title, subtitle, published_to_website, post_urls')
        .eq('id', liveVideoId)
        .single(),
      supabase
        .from('posts')
        .select('platform, status, created_at')
        .eq('video_id', liveVideoId)
        .order('created_at', { ascending: false }),
    ]);

    const liveVRow = liveVRowResult.data;

    // Public storage URLs (sync)
    let liveVideoMp4Url: string | null = null;
    let liveThumbUrl: string | null = null;
    if (liveVRow?.mp4_path) {
      const { data: u } = supabase.storage
        .from('videos')
        .getPublicUrl(liveVRow.mp4_path as string);
      liveVideoMp4Url = u?.publicUrl ?? null;
    }
    if (liveVRow?.thumb_path) {
      const { data: u } = supabase.storage
        .from('videos')
        .getPublicUrl(liveVRow.thumb_path as string);
      liveThumbUrl = u?.publicUrl ?? null;
    }

    // Build per-channel status list
    const postsByPlatform = new Map<string, { postedAt: string | null; postUrl: string | null }>();
    for (const p of livePostsResult.data ?? []) {
      if (p.status === 'published' && !postsByPlatform.has(p.platform as string)) {
        postsByPlatform.set(p.platform as string, {
          postedAt: (p.created_at as string | null) ?? null,
          postUrl: null,
        });
      }
    }

    const postUrls = (liveVRow?.post_urls as Record<string, string> | null) ?? {};
    for (const [platform, url] of Object.entries(postUrls)) {
      if (postsByPlatform.has(platform)) {
        postsByPlatform.set(platform, {
          ...(postsByPlatform.get(platform)!),
          postUrl: url,
        });
      }
    }

    const isPublishedToWebsite = !!(liveVRow?.published_to_website as boolean | null);
    const platformStatusList: PlatformStatus[] = [
      {
        platform: 'torahtaichi.com',
        postedAt: isPublishedToWebsite ? null : null, // TODO: surface actual published_at
        postUrl: isPublishedToWebsite ? `https://torahtaichi.com/${parsha.slug}` : null,
        viewsLabel: null,
      },
      ...Array.from(postsByPlatform.entries()).map(([platform, info]) => ({
        platform,
        postedAt: info.postedAt,
        postUrl: info.postUrl,
        viewsLabel: null,
      })),
    ];

    const liveIdx = videosForState.findIndex((v) => v.id === liveVideoId) + 1;
    const versionLabel = `v${liveIdx}`;

    // Fetch script_id from the live job (needed for DraftCalloutStrip replace flow)
    const liveVideoJobEntry = videosForState.find((v) => v.id === liveVideoId);
    const liveJobId = liveVideoJobEntry?.jobId ?? null;
    let liveScriptId: string | null = null;
    if (liveJobId) {
      const { data: liveJobDetail } = await supabase
        .from('jobs')
        .select('script_id')
        .eq('id', liveJobId)
        .single();
      liveScriptId = (liveJobDetail?.script_id as string | null) ?? null;
    }

    const draftStripPhase = statePhase;
    const draftJobId = state.kind === 'live-and-draft' ? state.draftJobId : null;
    const draftClips = draftJobId ? (clipsByJobId[draftJobId] ?? []) : [];
    const clipsRendered = draftClips.filter((c) => c.storagePath !== null).length;
    const clipsTotal = draftClips.length > 0 ? draftClips.length : null;

    return (
      <>
        {/* Draft callout strip above the live status display — live-and-draft only */}
        {state.kind === 'live-and-draft' && draftStripPhase && (
          <DraftCalloutStrip
            parshaSlug={parsha.slug}
            landingPhase={draftStripPhase}
            phase={draftStripPhase}
            clipsRendered={clipsRendered}
            clipsTotal={clipsTotal}
          />
        )}

        <LiveAtRestConnected
          parshaName={parsha.name}
          parshaId={parsha.id}
          sourceScriptId={liveScriptId ?? ''}
          versionLabel={versionLabel}
          videoMp4Url={liveVideoMp4Url ?? ''}
          thumbPath={liveThumbUrl}
          websiteUrl={`https://torahtaichi.com/${parsha.slug}`}
          title={(liveVRow?.title as string | null) ?? parsha.name}
          subtitle={(liveVRow?.subtitle as string | null) ?? ''}
          publishedToWebsiteSince={null}
          platforms={platformStatusList}
          parshaSlug={parsha.slug}
        />
      </>
    );
  }

  // Should not reach here — all states handled above.
  return null;
}

// ---------------------------------------------------------------------------
// Page entry point — renders shell immediately, streams body via Suspense.
// ---------------------------------------------------------------------------

export default async function VideoDetailPageNew({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;

  const continueParam = sp.continue === '1';
  const phaseParam =
    Number.isInteger(Number(sp.phase)) &&
    Number(sp.phase) >= 1 &&
    Number(sp.phase) <= 5
      ? (Number(sp.phase) as DraftPhase)
      : null;

  // Shell data: parsha + jobs + state (2 serial DB round-trips; inner 3 queries parallelized)
  const shell = await fetchPageShellData(slug, continueParam, phaseParam);
  if (!shell) notFound();

  const {
    parsha,
    state,
    videosForState,
    postsForState,
    jobsForState,
    clipsByJobId,
    liveStripProps,
    phase,
    statePhase,
    showDraftView,
  } = shell;

  // Determine stepper phase (only meaningful for draft views)
  const stepperPhase: DraftPhase | null =
    showDraftView && phase !== null ? phase : null;

  // Empty state: no stepper, no live strip — render entirely in shell (no Suspense).
  if (state.kind === 'empty') {
    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
        <BilingualHeader
          hebrewName={parsha.hebrew_name}
          book={parsha.book}
          name={parsha.name}
        />
        <Suspense fallback={null}>
          <PhaseBody
            slug={slug}
            phase={phase}
            showDraftView={showDraftView}
            state={state}
            parsha={parsha}
            jobsForState={jobsForState}
            videosForState={videosForState}
            postsForState={postsForState}
            clipsByJobId={clipsByJobId}
            liveStripProps={liveStripProps}
            statePhase={statePhase}
          />
        </Suspense>
      </div>
    );
  }

  // All other states: shell renders header + optional live strip + optional stepper immediately;
  // per-phase / per-state body streams in via Suspense.
  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
      {/* Shell — paints on first request, no per-phase data needed */}
      <BilingualHeader
        hebrewName={parsha.hebrew_name}
        book={parsha.book}
        name={parsha.name}
      />
      {liveStripProps && <PersistentLiveStrip {...liveStripProps} />}
      {stepperPhase !== null && <CompressedStepper currentPhase={stepperPhase} />}

      {/* Body — streams in; skeleton holds layout while fetching */}
      <Suspense fallback={<PhaseSkeleton phase={stepperPhase} />}>
        <PhaseBody
          slug={slug}
          phase={phase}
          showDraftView={showDraftView}
          state={state}
          parsha={parsha}
          jobsForState={jobsForState}
          videosForState={videosForState}
          postsForState={postsForState}
          clipsByJobId={clipsByJobId}
          liveStripProps={liveStripProps}
          statePhase={statePhase}
        />
      </Suspense>
    </div>
  );
}
