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

import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { selectPageState } from '@/lib/page-state';
import type { DraftPhase } from '@/lib/page-state';
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

export default async function VideoDetailPageNew({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  // ?continue=1 means "show the draft phase view" from the live+draft landing.
  // ?phase=N overrides the state machine's phase (used by DraftCalloutStrip links
  // and Phase 4 → Phase 5 "Continue to posting" navigation).
  const continueParam = sp.continue === '1';
  const phaseParam = Number.isInteger(Number(sp.phase)) && Number(sp.phase) >= 1 && Number(sp.phase) <= 5
    ? (Number(sp.phase) as DraftPhase)
    : null;

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

  // The effective phase for rendering draft views.
  // phaseParam overrides the state machine (used by DraftCalloutStrip links and
  // Phase 4 → Phase 5 manual navigation via "Continue to posting →").
  const statePhase =
    state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
      ? state.phase
      : null;
  const phase = phaseParam ?? statePhase;

  // ---------------------------------------------------------------------------
  // State: empty — no scripts, no video, nothing live.
  // ---------------------------------------------------------------------------
  if (state.kind === 'empty') {
    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
        <BilingualHeader
          hebrewName={parsha.hebrew_name}
          book={parsha.book}
          name={parsha.name}
        />
        <EmptyState
          parshaName={parsha.name}
          parshaId={parsha.id}
          parshaSlug={parsha.slug}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // For live-and-draft: check if we should render the draft view or the landing.
  // When continueParam is not set, live-and-draft renders the landing (strip + live-at-rest).
  // When continueParam=1 (or phaseParam is set), render the draft phase view.
  const showDraftView =
    state.kind === 'draft-in-progress' ||
    (state.kind === 'live-and-draft' && (continueParam || phaseParam !== null));

  // ---------------------------------------------------------------------------
  // Phase 1: Script editor
  // ---------------------------------------------------------------------------
  if (showDraftView && phase === 1) {
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
  if (showDraftView && phase === 2) {
    const draftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;
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
  if (showDraftView && phase === 3) {
    const draftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;

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
  if (showDraftView && phase === 4) {
    const draftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;
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
  // Phase 5: Posting
  // ---------------------------------------------------------------------------
  if (showDraftView && phase === 5) {
    const draftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    const draftVideoId = draftJobForState?.videoId ?? null;

    // Fetch the video row for site fields + mp4 + thumb
    let videoRow: { id: string; mp4_path: string | null; thumb_path: string | null; title: string | null; subtitle: string | null; description: string | null; published_to_website: boolean; post_urls: Record<string, string> | null } | null = null;
    if (draftVideoId) {
      const { data: vRow } = await supabase
        .from('videos')
        .select('id, mp4_path, thumb_path, title, subtitle, description, published_to_website, post_urls')
        .eq('id', draftVideoId)
        .single();
      if (vRow) {
        videoRow = {
          id: vRow.id as string,
          mp4_path: (vRow.mp4_path as string | null) ?? null,
          thumb_path: (vRow.thumb_path as string | null) ?? null,
          title: (vRow.title as string | null) ?? null,
          subtitle: (vRow.subtitle as string | null) ?? null,
          description: (vRow.description as string | null) ?? null,
          published_to_website: !!(vRow.published_to_website as boolean | null),
          post_urls: (vRow.post_urls as Record<string, string> | null) ?? null,
        };
      }
    }

    // Fetch canonical clip plan for captions + social_metadata + youtube_tags
    const supabaseSvc = createServiceClient();
    const canonicalPlan = draftJobId
      ? await getCanonicalClipPlan(supabaseSvc, draftJobId)
      : null;
    const planJson = (canonicalPlan?.planJson ?? {}) as Record<string, unknown>;
    const captions = ((planJson.captions as Record<string, string> | undefined) ?? {});

    // Fetch top-level clip_plan columns (social_metadata + youtube_tags live outside plan_json)
    let clipPlanMeta: { social_metadata: Record<string, unknown> | null; youtube_tags: string[] } = { social_metadata: null, youtube_tags: [] };
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

    // Fetch posts for this video (last 30 days, latest per platform)
    let initialPosts: Array<{
      id: string;
      platform: string;
      status: string;
      created_at: string;
      scheduled_at: string | null;
      buffer_update_id: string | null;
      caption: string | null;
    }> = [];
    if (draftVideoId) {
      const { data: pRows } = await supabase
        .from('posts')
        .select('id, platform, status, created_at, scheduled_at, buffer_update_id, caption')
        .eq('video_id', draftVideoId)
        .order('created_at', { ascending: false });
      initialPosts = (pRows ?? []).map((p) => ({
        id: p.id as string,
        platform: p.platform as string,
        status: p.status as string,
        created_at: (p.created_at as string | null) ?? new Date(0).toISOString(),
        scheduled_at: (p.scheduled_at as string | null) ?? null,
        buffer_update_id: (p.buffer_update_id as string | null) ?? null,
        caption: (p.caption as string | null) ?? null,
      }));
    }

    // Connected platforms
    const connectedPlatforms = await getConnectedPlatforms();

    // Public MP4 URL for the frame picker
    let videoMp4Url: string | null = null;
    if (videoRow?.mp4_path) {
      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(videoRow.mp4_path);
      videoMp4Url = urlData?.publicUrl ?? null;
    }
    let thumbPublicUrl: string | null = null;
    if (videoRow?.thumb_path) {
      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(videoRow.thumb_path);
      thumbPublicUrl = urlData?.publicUrl ?? null;
    }

    // Live state for site card
    const siteIsLive = videoRow?.published_to_website ?? false;
    // Use the video's published_at as liveSince — fall back to null (column may not exist)
    // We'll just use null for now since we don't have a published_at column tracked separately
    const liveSince = siteIsLive ? null : null; // TODO: surface actual published_at when added

    const liveVideoIndex = videosForState.findIndex((v) => v.id === draftVideoId) + 1;
    const liveVersionLabel = siteIsLive ? `v${liveVideoIndex}` : null;

    // Fetch the script_id for this draft job so onSiteReplace can clone it.
    let draftScriptId: string | null = null;
    if (draftJobId) {
      const { data: jobDetail } = await supabase
        .from('jobs')
        .select('script_id')
        .eq('id', draftJobId)
        .single();
      draftScriptId = (jobDetail?.script_id as string | null) ?? null;
    }

    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
        <BilingualHeader
          hebrewName={parsha.hebrew_name}
          book={parsha.book}
          name={parsha.name}
        />
        {liveStripProps && <PersistentLiveStrip {...liveStripProps} />}
        <CompressedStepper currentPhase={5} />
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
          socialMetadata={clipPlanMeta.social_metadata as { instagram?: { type: 'reel' | 'post'; firstComment?: string }; facebook?: { type: 'reel' | 'post'; firstComment?: string } } | null}
          initialPosts={initialPosts}
          postUrls={(videoRow?.post_urls ?? {}) as Record<string, string>}
          connectedPlatforms={connectedPlatforms}
          videoMp4Url={videoMp4Url}
          thumbPath={thumbPublicUrl}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // State: live-at-rest — has live version, no draft.
  // State: live-and-draft landing — has both, but no continue/phase param set.
  // Both render LiveAtRest. live-and-draft also prepends DraftCalloutStrip.
  // ---------------------------------------------------------------------------
  if (state.kind === 'live-at-rest' || state.kind === 'live-and-draft') {
    const liveVideoId =
      state.kind === 'live-at-rest' ? state.liveVideoId : state.liveVideoId;

    // Fetch the live video row for player + metadata.
    const { data: liveVRow } = await supabase
      .from('videos')
      .select('id, mp4_path, thumb_path, title, subtitle, published_to_website, post_urls')
      .eq('id', liveVideoId)
      .single();

    let liveVideoMp4Url: string | null = null;
    let liveThumbUrl: string | null = null;
    if (liveVRow?.mp4_path) {
      const { data: u } = supabase.storage.from('videos').getPublicUrl(liveVRow.mp4_path as string);
      liveVideoMp4Url = u?.publicUrl ?? null;
    }
    if (liveVRow?.thumb_path) {
      const { data: u } = supabase.storage.from('videos').getPublicUrl(liveVRow.thumb_path as string);
      liveThumbUrl = u?.publicUrl ?? null;
    }

    // Fetch posts for the live video to build the per-channel status list.
    const { data: livePosts } = await supabase
      .from('posts')
      .select('platform, status, created_at')
      .eq('video_id', liveVideoId)
      .order('created_at', { ascending: false });

    // Build per-channel status list. Website is always first; then social platforms.
    // Only show platforms that are connected or have been posted to.
    const postsByPlatform = new Map<string, { postedAt: string | null; postUrl: string | null }>();
    for (const p of livePosts ?? []) {
      if (p.status === 'published' && !postsByPlatform.has(p.platform as string)) {
        postsByPlatform.set(p.platform as string, {
          postedAt: (p.created_at as string | null) ?? null,
          postUrl: null, // post_urls is on videos row
        });
      }
    }

    const postUrls = (liveVRow?.post_urls as Record<string, string> | null) ?? {};
    // Merge post URLs into the platform map
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
      // Website row — always first
      {
        platform: 'torahtaichi.com',
        postedAt: isPublishedToWebsite ? null : null, // TODO: surface actual published_at
        postUrl: isPublishedToWebsite ? `https://torahtaichi.com/${parsha.slug}` : null,
        viewsLabel: null,
      },
      // Social platforms that have been posted to
      ...Array.from(postsByPlatform.entries()).map(([platform, info]) => ({
        platform,
        postedAt: info.postedAt,
        postUrl: info.postUrl,
        viewsLabel: null,
      })),
    ];

    // Version label for the live video ("v2", etc.)
    const liveIdx = videosForState.findIndex((v) => v.id === liveVideoId) + 1;
    const versionLabel = `v${liveIdx}`;

    // For live-and-draft: the script to clone when user hits Replace.
    // We need the source script from the LIVE video's job.
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

    // For DraftCalloutStrip: compute landingPhase per spec §3.2.
    // This is the "most recent completed phase" = statePhase (phaseFor already returns this).
    const draftStripPhase = statePhase;
    const draftJobId = state.kind === 'live-and-draft' ? state.draftJobId : null;
    const draftClips = draftJobId ? (clipsByJobId[draftJobId] ?? []) : [];
    const clipsRendered = draftClips.filter((c) => c.storagePath !== null).length;
    const clipsTotal = draftClips.length > 0 ? draftClips.length : null;

    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
        <BilingualHeader
          hebrewName={parsha.hebrew_name}
          book={parsha.book}
          name={parsha.name}
        />

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
      </div>
    );
  }

  // Should never reach here — all 4 states are handled above.
  notFound();
}
