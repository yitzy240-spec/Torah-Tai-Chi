// dashboard/src/app/videos/[slug]/page-new.tsx
//
// Redesigned video detail page (spec §3 — 4-state architecture).
// Dispatched from page.tsx when video_page_v2 flag is on or ?v2=1.
//
// Architecture:
//   - Shell data (parsha + jobs + state) fetched before the Suspense boundary
//     so the header + live-strip + stepper paint on first request.
//   - All per-phase and per-state data fetches live in _data/ files and are
//     called from <PhaseBody> (async server component) inside <Suspense>.
//   - <PhaseSkeleton> provides a minimal placeholder while the body streams in.

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { DraftPhase } from '@/lib/page-state';
import { fetchPageShellData } from './_data/shell-data';
import { getPhase1Props } from './_data/phase-1-data';
import { getPhase2Props } from './_data/phase-2-data';
import { getPhase3Props } from './_data/phase-3-data';
import { getPhase4Props } from './_data/phase-4-data';
import { getPhase5Props } from './_data/phase-5-data';
import { getLiveAtRestProps } from './_data/live-at-rest-data';
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
import { DraftCalloutStrip } from './_components/draft-callout-strip';
import { PlanGeneratingCard } from './_components/plan-generating-card';
import type { ShellData } from './_data/shell-data';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// ---------------------------------------------------------------------------
// PhaseSkeleton — minimal grey placeholder while PhaseBody streams in.
// ---------------------------------------------------------------------------

function PhaseSkeleton({ phase }: { phase: DraftPhase | null }) {
  const cardCount =
    phase === 1
      ? 1
      : phase === 2 || phase === 3
        ? 3
        : phase === 4
          ? 1
          : phase === 5
            ? 5
            : 2;

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
// PhaseBody — async server component; all per-phase data fetches live here.
// Renders inside <Suspense> so the shell paints first.
// ---------------------------------------------------------------------------

async function PhaseBody({
  phase,
  showDraftView,
  state,
  parsha,
  jobsForState,
  videosForState,
  clipsByJobId,
  statePhase,
}: {
  phase: DraftPhase | null;
  showDraftView: boolean;
  state: ShellData['state'];
  parsha: ShellData['parsha'];
  jobsForState: ShellData['jobsForState'];
  videosForState: ShellData['videosForState'];
  clipsByJobId: ShellData['clipsByJobId'];
  statePhase: ShellData['statePhase'];
}) {
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
    const props = getPhase1Props(parsha);
    if (!props) {
      return (
        <p style={{ color: 'var(--ink-500)' }}>
          Generating the script… check back in a moment.
        </p>
      );
    }
    return <Phase1ScriptConnected {...props} />;
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

    // Plan-only job is queued / generating but hasn't produced the plan yet.
    // Show a calm in-progress card with elapsed time so the operator sees life.
    if (!clipPlanId && draftJobId && draftJobForState) {
      const startedAt = draftJobForState.triggeredAt;
      return (
        <PlanGeneratingCard startedAt={startedAt} jobId={draftJobId} />
      );
    }

    if (!clipPlanId || !draftJobId) {
      return (
        <p style={{ color: 'var(--ink-500)' }}>
          Generating clip plan… check back in a moment.
        </p>
      );
    }

    const props = await getPhase2Props(parsha.slug, draftJobId, clipPlanId);
    return <Phase2PlanReviewConnected {...props} />;
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

    const props = await getPhase3Props(parsha.slug, draftJobId, draftVideoId);
    return <Phase3ClipsConnected {...props} />;
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

    if (!draftJobId || !draftVideoId) {
      return (
        <p style={{ color: 'var(--ink-500)' }}>
          Stitching in progress… check back in a moment.
        </p>
      );
    }

    const props = await getPhase4Props(draftJobId, draftVideoId, clipPlanId);
    return <Phase4StitchedConnected {...props} />;
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

    if (!draftJobId || !draftVideoId) {
      return (
        <p style={{ color: 'var(--ink-500)' }}>
          Video not yet available… check back in a moment.
        </p>
      );
    }

    const { liveVideoIndex: _unused, ...phase5Props } = await getPhase5Props(
      parsha.slug,
      parsha.id,
      parsha.name,
      draftJobId,
      draftVideoId,
      videosForState,
    );
    return <Phase5PostConnected {...phase5Props} />;
  }

  // -------------------------------------------------------------------------
  // State: live-at-rest or live-and-draft landing
  // -------------------------------------------------------------------------
  if (state.kind === 'live-at-rest' || state.kind === 'live-and-draft') {
    const liveVideoId = state.liveVideoId;
    const draftJobId = state.kind === 'live-and-draft' ? state.draftJobId : null;

    const props = await getLiveAtRestProps(
      parsha.slug,
      parsha.name,
      parsha.id,
      liveVideoId,
      videosForState,
      clipsByJobId,
      statePhase,
      draftJobId,
    );

    return (
      <>
        {state.kind === 'live-and-draft' && props.draftStripPhase && (
          <DraftCalloutStrip
            parshaSlug={parsha.slug}
            landingPhase={props.draftStripPhase}
            phase={props.draftStripPhase}
            clipsRendered={props.clipsRendered}
            clipsTotal={props.clipsTotal}
          />
        )}
        <LiveAtRestConnected
          parshaName={props.parshaName}
          parshaId={props.parshaId}
          sourceScriptId={props.sourceScriptId}
          versionLabel={props.versionLabel}
          videoMp4Url={props.videoMp4Url}
          thumbPath={props.thumbPath}
          websiteUrl={props.websiteUrl}
          displayTitle={props.displayTitle}
          attribution={props.attribution}
          publishedToWebsiteSince={props.publishedToWebsiteSince}
          platforms={props.platforms}
          parshaSlug={props.parshaSlug}
          videoId={props.videoId}
          siteTitle={props.siteTitle}
          siteSubtitle={props.siteSubtitle}
          siteDescription={props.siteDescription}
          siteWebsiteCaption={props.siteWebsiteCaption}
          siteSpokenScript={props.siteSpokenScript}
          liveJobId={props.liveJobId}
          captions={props.captions}
          youtubeTags={props.youtubeTags}
          socialMetadata={props.socialMetadata}
          initialPosts={props.livePosts}
          postUrls={props.postUrls}
          connectedPlatforms={props.connectedPlatforms}
        />
      </>
    );
  }

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

  const shell = await fetchPageShellData(slug, continueParam, phaseParam);
  if (!shell) notFound();

  const {
    parsha,
    state,
    videosForState,
    jobsForState,
    clipsByJobId,
    liveStripProps,
    phase,
    statePhase,
    showDraftView,
  } = shell;

  const stepperPhase: DraftPhase | null =
    showDraftView && phase !== null ? phase : null;

  // Empty state: no stepper, no live strip.
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
            phase={phase}
            showDraftView={showDraftView}
            state={state}
            parsha={parsha}
            jobsForState={jobsForState}
            videosForState={videosForState}
            clipsByJobId={clipsByJobId}
            statePhase={statePhase}
          />
        </Suspense>
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
      {liveStripProps && state.kind === 'live-and-draft' && showDraftView && (
        <PersistentLiveStrip {...liveStripProps} />
      )}
      {stepperPhase !== null && <CompressedStepper currentPhase={stepperPhase} />}

      <Suspense fallback={<PhaseSkeleton phase={stepperPhase} />}>
        <PhaseBody
          phase={phase}
          showDraftView={showDraftView}
          state={state}
          parsha={parsha}
          jobsForState={jobsForState}
          videosForState={videosForState}
          clipsByJobId={clipsByJobId}
          statePhase={statePhase}
        />
      </Suspense>
    </div>
  );
}
