// dashboard/src/app/videos/[slug]/page.tsx
//
// Video detail page (spec §3 — 4-state architecture). Legacy
// video page + cookie-based dispatcher removed 2026-05-29 — Yonah
// shipped his first video on this flow so we cut the old one over
// permanently.
//
// Architecture:
//   - Shell data (parsha + jobs + state) fetched before the Suspense boundary
//     so the header + live-strip + stepper paint on first request.
//   - All per-phase and per-state data fetches live in _data/ files and are
//     called from <PhaseBody> (async server component) inside <Suspense>.
//   - <PhaseSkeleton> provides a minimal placeholder while the body streams in.

import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { triggerPlanOnly } from '@/app/actions/video-page/trigger-plan-only';
import type { DraftPhase } from '@/lib/page-state';
import { fetchPageShellData } from './_data/shell-data';
import { getPhase1Props } from './_data/phase-1-data';
import { getPhase2Props } from './_data/phase-2-data';
import { getPhase3Props } from './_data/phase-3-data';
import { getPhase4Props } from './_data/phase-4-data';
import { getPhase5Props } from './_data/phase-5-data';
import { getLiveAtRestProps } from './_data/live-at-rest-data';
import { BackToTodayLink } from './_components/back-to-today-link';
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
import { PhaseErrorBoundary } from './_components/phase-error-boundary';
import type { ShellData } from './_data/shell-data';

/**
 * Walk up the regen_of_job_id chain to find the plan-only ancestor.
 *
 * Why: `state.draftJobId` is whatever job most recently advanced the
 * draft. Once a compose job exists, that becomes the draftJobId — but
 * the compose job owns the stitched mp4, not the editable clip
 * metadata. Phase 2 (plan review) and Phase 3 (clips) MUST operate on
 * the plan-only root, because that's where the per-clip
 * voiceover/visual_prompt/motion_ref_slug rows live. Without this
 * traversal, navigating BACK to Phase 2 or 3 from Phase 4 or 5
 * (Yonah's 2026-06-01 "back to clips" report) lands on the compose
 * job's empty clip set and renders nothing.
 *
 * Returns the input id if it's already a plan-only / root (regenOfJobId
 * is null), or null if the chain breaks.
 */
function resolvePlanJobId(
  jobsForState: ShellData['jobsForState'],
  jobId: string | null,
): string | null {
  if (!jobId) return null;
  let current: string | null = jobId;
  const seen = new Set<string>();
  while (current !== null) {
    if (seen.has(current)) return null; // cycle guard, shouldn't happen
    seen.add(current);
    const job = jobsForState.find((j) => j.id === current);
    if (!job) return null;
    if (!job.regenOfJobId) return current; // root reached
    current = job.regenOfJobId;
  }
  return null;
}

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
  startPlan,
  startPlanScriptId,
}: {
  phase: DraftPhase | null;
  showDraftView: boolean;
  state: ShellData['state'];
  parsha: ShellData['parsha'];
  jobsForState: ShellData['jobsForState'];
  videosForState: ShellData['videosForState'];
  clipsByJobId: ShellData['clipsByJobId'];
  statePhase: ShellData['statePhase'];
  startPlan: boolean;
  startPlanScriptId: string | null;
}) {
  // -------------------------------------------------------------------------
  // State: empty
  // -------------------------------------------------------------------------
  if (state.kind === 'empty') {
    return (
      <PhaseErrorBoundary phaseLabel="Empty parsha">
        <EmptyState
          parshaName={parsha.name}
          parshaId={parsha.id}
          parshaSlug={parsha.slug}
        />
      </PhaseErrorBoundary>
    );
  }

  // -------------------------------------------------------------------------
  // Phase 1: Script editor
  // -------------------------------------------------------------------------
  if (showDraftView && phase === 1) {
    const props = getPhase1Props(parsha);
    if (!props) {
      return (
        <PhaseErrorBoundary phaseLabel="Phase 1 (script)">
          <p style={{ color: 'var(--ink-500)' }}>
            Generating the script… check back in a moment.
          </p>
        </PhaseErrorBoundary>
      );
    }
    return (
      <PhaseErrorBoundary phaseLabel="Phase 1 (script)">
        <Phase1ScriptConnected {...props} />
      </PhaseErrorBoundary>
    );
  }

  // -------------------------------------------------------------------------
  // Phase 2: Plan review
  // -------------------------------------------------------------------------
  if (showDraftView && phase === 2) {
    const stateDraftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;
    // Same plan-only-ancestor resolution as Phase 3 — the clipPlanId
    // and clip metadata live on the plan-only root, not on the
    // compose/clips-only descendants. Navigating BACK to Phase 2 from
    // Phase 4 used to hit the compose job and fall into an infinite
    // "Starting clip plan…" spinner because compose jobs have no
    // clipPlanId. (2026-06-01 audit alongside the Phase 3 fix.)
    const draftJobId = resolvePlanJobId(jobsForState, stateDraftJobId);
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    const clipPlanId = draftJobForState?.clipPlanId ?? null;

    // Intent fast path: user clicked "Generate clip plan" on Phase 1.
    // Two cases trigger an insert here:
    //
    //   1. No draft job yet — first run for this parsha.
    //   2. A draft job exists, but its script_id differs from the one
    //      the operator just selected. They went back, picked a
    //      different alternate, and hit Generate again — that's an
    //      explicit "regenerate plan with new script" request. Without
    //      this case the URL's new script_id is ignored and Phase 2
    //      keeps showing the old plan (Yonah's 2026-05-27 report).
    //
    // The newer plan-only job becomes the current draft via
    // selectPageState's triggered_at-DESC ordering — the old job is
    // orphaned but harmless. We do NOT delete it because its clip rows
    // may still be referenced by in-flight clips-only/regen jobs.
    //
    // Doing the insert in the server component avoids client-side
    // useEffect coordination (which kept users stuck on
    // StartingPlanCard because router.refresh wasn't picking up the
    // new job reliably).
    let planError: string | null = null;
    if (startPlan && startPlanScriptId) {
      const scriptMismatch =
        draftJobForState != null && draftJobForState.scriptId !== startPlanScriptId;
      if (!draftJobId || scriptMismatch) {
        const result = await triggerPlanOnly(parsha.id, startPlanScriptId);
        if (result.ok) {
          redirect(`/videos/${parsha.slug}?phase=2`);
        }
        planError = result.error ?? 'Unknown error starting clip plan generation.';
      }
    }

    if (planError) {
      return (
        <PhaseErrorBoundary phaseLabel="Phase 2 (plan review)">
          <div
            role="alert"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '48px 24px',
              minHeight: 240,
              background: 'var(--linen-50)',
              border: '1px solid var(--tassel)',
              borderRadius: 'var(--r-lg)',
              textAlign: 'center',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'var(--tassel)',
                color: 'white',
                fontSize: 22,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
              }}
            >
              !
            </div>
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontSize: 20,
                fontWeight: 500,
                color: 'var(--ink-900)',
                marginBottom: 8,
              }}
            >
              Couldn&apos;t start clip plan generation
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--ink-500)',
                maxWidth: 360,
                lineHeight: 1.5,
                marginBottom: 16,
              }}
            >
              {planError.split('\n')[0].slice(0, 220)}
            </div>
            <a
              href={`/videos/${parsha.slug}?phase=1`}
              style={{
                minHeight: 44,
                padding: '10px 18px',
                fontSize: 14,
                fontWeight: 500,
                background: 'white',
                color: 'var(--navy-700)',
                border: '1px solid var(--navy-700)',
                borderRadius: 8,
                cursor: 'pointer',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              ← Back to script
            </a>
          </div>
        </PhaseErrorBoundary>
      );
    }

    // Plan-only job is queued / generating but hasn't produced the plan yet.
    // Show a calm in-progress card with elapsed time so the operator sees life.
    if (!clipPlanId && draftJobId && draftJobForState) {
      const startedAt = draftJobForState.triggeredAt;
      return (
        <PhaseErrorBoundary phaseLabel="Phase 2 (plan review)">
          <PlanGeneratingCard startedAt={startedAt} jobId={draftJobId} />
        </PhaseErrorBoundary>
      );
    }

    if (!clipPlanId || !draftJobId) {

      // Brief in-between state for direct ?phase=2 nav with no intent.
      // Show the same spinner card as PlanGeneratingCard so the
      // operator doesn't see a bare text placeholder.
      return (
        <PhaseErrorBoundary phaseLabel="Phase 2 (plan review)">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '48px 24px',
              minHeight: 240,
              background: 'var(--linen-50)',
              border: '1px solid var(--ink-100)',
              borderRadius: 'var(--r-lg)',
              textAlign: 'center',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '3px solid var(--ink-100)',
                borderTopColor: 'var(--navy-700)',
                animation: 'spin 0.9s linear infinite',
                marginBottom: 18,
              }}
            />
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontSize: 20,
                fontWeight: 500,
                color: 'var(--ink-900)',
                marginBottom: 8,
              }}
            >
              Starting clip plan…
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-500)', maxWidth: 360, lineHeight: 1.5 }}>
              Setting up the job — the spinner will switch to live progress in a moment.
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </PhaseErrorBoundary>
      );
    }

    const props = await getPhase2Props(parsha.slug, draftJobId, clipPlanId);
    return (
      <PhaseErrorBoundary phaseLabel="Phase 2 (plan review)">
        <Phase2PlanReviewConnected {...props} />
      </PhaseErrorBoundary>
    );
  }

  // -------------------------------------------------------------------------
  // Phase 3: Clips
  // -------------------------------------------------------------------------
  if (showDraftView && phase === 3) {
    const stateDraftJobId =
      state.kind === 'draft-in-progress' || state.kind === 'live-and-draft'
        ? state.draftJobId
        : null;
    // Resolve to plan-only ancestor — Phase 3 reads clip metadata from
    // the plan-only root, not the compose/clips-only descendants. See
    // resolvePlanJobId() docstring for the rationale.
    const draftJobId = resolvePlanJobId(jobsForState, stateDraftJobId);
    const draftJobForState = jobsForState.find((jj) => jj.id === draftJobId);
    // For the videoId we still want the latest compose's video (the
    // stitched mp4 surface used by Phase 3 navigation/preview), not
    // the plan-only's (which is null). Look it up from the original
    // state.draftJobId.
    const stateJobForVideo = jobsForState.find((jj) => jj.id === stateDraftJobId);
    const draftVideoId = stateJobForVideo?.videoId ?? draftJobForState?.videoId ?? null;

    if (!draftVideoId || !draftJobId) {
      return (
        <PhaseErrorBoundary phaseLabel="Phase 3 (clip review)">
          <p style={{ color: 'var(--ink-500)' }}>
            Clips are generating… check back in a moment.
          </p>
        </PhaseErrorBoundary>
      );
    }

    const props = await getPhase3Props(parsha.slug, draftJobId, draftVideoId);
    return (
      <PhaseErrorBoundary phaseLabel="Phase 3 (clip review)">
        <Phase3ClipsConnected {...props} />
      </PhaseErrorBoundary>
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

    if (!draftJobId || !draftVideoId) {
      return (
        <PhaseErrorBoundary phaseLabel="Phase 4 (stitched video)">
          <p style={{ color: 'var(--ink-500)' }}>
            Stitching in progress… check back in a moment.
          </p>
        </PhaseErrorBoundary>
      );
    }

    const props = await getPhase4Props(draftJobId, draftVideoId, clipPlanId);
    return (
      <PhaseErrorBoundary phaseLabel="Phase 4 (stitched video)">
        <Phase4StitchedConnected parshaSlug={parsha.slug} {...props} />
      </PhaseErrorBoundary>
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

    if (!draftJobId || !draftVideoId) {
      return (
        <PhaseErrorBoundary phaseLabel="Phase 5 (posting)">
          <p style={{ color: 'var(--ink-500)' }}>
            Video not yet available… check back in a moment.
          </p>
        </PhaseErrorBoundary>
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
    return (
      <PhaseErrorBoundary phaseLabel="Phase 5 (posting)">
        <Phase5PostConnected {...phase5Props} />
      </PhaseErrorBoundary>
    );
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
      <PhaseErrorBoundary phaseLabel="Live page">
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
      </PhaseErrorBoundary>
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
  const startPlan = sp.start_plan === '1';
  const startPlanScriptId = typeof sp.script === 'string' ? sp.script : null;

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
        <BackToTodayLink />
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
            startPlan={startPlan}
            startPlanScriptId={startPlanScriptId}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '24px 16px' }}>
      <BackToTodayLink />
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
          startPlan={startPlan}
          startPlanScriptId={startPlanScriptId}
        />
      </Suspense>
    </div>
  );
}
