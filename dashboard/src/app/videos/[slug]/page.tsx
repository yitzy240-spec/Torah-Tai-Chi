import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformIcon } from '@/components/platform-icon';
import { ScheduleAllSheet } from '@/components/schedule-all-sheet';
import { CaptionsList } from '@/components/captions-list';
import { PublishToSiteToggle } from '@/components/publish-to-site-toggle';
import { ScriptCarousel } from '@/components/script-carousel';
import type { FeedbackClip } from '@/components/video-feedback';
import { VideoVersionsView, type VersionInfo } from '@/components/video-versions-view';
import { PLATFORMS, type Platform } from '@/lib/platforms';
import { publicVideoUrl } from '@/lib/storage-url';
import { estimateSeedanceCost, type Resolution, type ModelTier } from '@/lib/seedance-pricing';
import { pickActiveVersion, resolveInitialSelectedId } from '@/lib/active-version';
import { getConnectedPlatforms } from '@/lib/connected-platforms';

interface Script {
  id: string;
  option: string;
  title: string | null;
  tldr: string | null;
  draft_text: string | null;
  director_notes: string | null;
  motion_ref_slug: string | null;
}

interface Parsha {
  id: string;
  order: number;
  name: string;
  book: string;
  slug: string;
  hebrew_name: string | null;
  scripts: Script[];
}

async function getParsha(slug: string): Promise<Parsha | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('parshiot')
    .select('id, order, name, book, slug, hebrew_name, scripts(id, option, title, tldr, draft_text, director_notes, motion_ref_slug)')
    .eq('slug', slug)
    .single();

  if (error || !data) return null;
  return data as Parsha;
}

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** Build a captions VTT data URL + flat FeedbackClip[] for a single
 *  job's clip plan. Pulled out of the page body so we can call it once
 *  per version when assembling VersionInfo[]. */
function buildClipPayload(
  planJson: unknown,
  clipRows: Array<{ id: string; index: number }>,
): { captionsVttDataUrl: string | null; clips: FeedbackClip[]; totalDurationS: number } {
  const plan = (planJson ?? {}) as {
    clips?: Array<{ voiceover?: string; duration_s?: number; index?: number }>;
  };
  if (!Array.isArray(plan.clips) || plan.clips.length === 0) {
    return { captionsVttDataUrl: null, clips: [], totalDurationS: 0 };
  }
  const ordered = [...plan.clips].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const fmt = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s - h * 3600 - m * 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
  };
  let cur = 0;
  const cues: string[] = [];
  for (const c of ordered) {
    const dur = c.duration_s ?? 0;
    const text = (c.voiceover ?? '').trim();
    if (dur > 0 && text) cues.push(`${fmt(cur)} --> ${fmt(cur + dur)}\n${text}`);
    cur += dur;
  }
  const captionsVttDataUrl =
    cues.length > 0
      ? `data:text/vtt;charset=utf-8;base64,${Buffer.from('WEBVTT\n\n' + cues.join('\n\n') + '\n', 'utf-8').toString('base64')}`
      : null;

  const idByIndex = new Map<number, string>(clipRows.map((r) => [r.index, r.id]));
  const clips: FeedbackClip[] = [];
  let cursorS = 0;
  for (const c of ordered) {
    const dur = c.duration_s ?? 0;
    const idx = c.index ?? 0;
    const id = idByIndex.get(idx);
    const start = cursorS;
    cursorS += dur;
    if (!id) continue;
    clips.push({
      id,
      voiceover: (c.voiceover ?? '').trim(),
      startS: start,
      endS: cursorS,
    });
  }
  return { captionsVttDataUrl, clips, totalDurationS: cursorS };
}


export default async function VideoDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const parsha = await getParsha(slug);
  if (!parsha) notFound();

  const aTight = parsha.scripts?.find((s) => s.option === 'A-tight') ?? null;

  // Yonah's saved default quality tier (falls back to 720p standard).
  const { data: defaultTierRow } = await supabase
    .from('site_content')
    .select('value')
    .eq('key', 'settings.default_tier')
    .maybeSingle();
  const defaultTierKey: string = defaultTierRow?.value ?? '720p standard';

  // Fetch ALL done jobs for this parsha in chronological order so we can
  // surface the regen chain. The earliest is v1; subsequent rows are
  // regen_of_<previous>. We sort by triggered_at since that's a non-null
  // timestamp for every job; videos.created_at is a tighter signal but
  // jobs come first so they're guaranteed present.
  const { data: doneJobsRaw } = await supabase
    .from('jobs')
    .select('id, resolution, model_tier, total_cost_usd, regen_of_job_id, triggered_at, videos(id, mp4_path, thumb_path, published_to_website, created_at)')
    .eq('parsha_id', parsha.id)
    .eq('status', 'done')
    .order('triggered_at', { ascending: true });

  // Flatten jobs → versions, dropping any job without an attached video
  // (defensive — done jobs should always have one).
  type DoneJobRow = {
    id: string;
    resolution: string | null;
    model_tier: string | null;
    total_cost_usd: number | null;
    regen_of_job_id: string | null;
    triggered_at: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    videos: any;
  };
  const doneJobs = (doneJobsRaw ?? []) as DoneJobRow[];

  const versionRows = doneJobs.flatMap((j) => {
    const videoRel = j.videos;
    const v = (Array.isArray(videoRel) ? videoRel[0] : videoRel) ?? null;
    if (!v?.id) return [];
    return [{
      jobId: j.id,
      videoId: v.id as string,
      mp4Path: v.mp4_path as string | null,
      thumbPath: v.thumb_path as string | null,
      publishedToWebsite: !!v.published_to_website,
      createdAt: (v.created_at as string | null) ?? (j.triggered_at as string | null) ?? new Date(0).toISOString(),
      resolution: (j.resolution as Resolution | null) ?? null,
      modelTier: (j.model_tier as ModelTier | null) ?? null,
      totalCostUsd: (j.total_cost_usd as number | null) ?? null,
      isRegen: !!j.regen_of_job_id,
    }];
  });

  // Latest = canonical "live" version: drives captions, distribution, cost.
  const latest = versionRows.length > 0 ? versionRows[versionRows.length - 1] : null;

  // Resolve which version is "selected": `?v=<videoId>` if it matches
  // a known version; otherwise the version currently live on the
  // website (if any); otherwise the latest. Once a video is published
  // for this parsha, it becomes the default view — newer drafts are
  // still in the version chips, just not pre-selected.
  const requestedVid = typeof sp.v === 'string' ? sp.v : null;
  const initialSelectedId = resolveInitialSelectedId(versionRows, requestedVid);
  const compareParam = typeof sp.compare === 'string' ? sp.compare : null;
  const initialCompare = compareParam === '1' && versionRows.length >= 2;

  // Per-version clip payloads — captions/clips are version-specific because
  // each regen has its own clip_plan with potentially different voiceovers.
  // We also pull the feedback row whose applied_to_job_id = jobId so we can
  // show the subtitle "Generated from feedback: '<text>'".
  const versionInfos: VersionInfo[] = [];
  for (const row of versionRows) {
    const { data: planRow } = await supabase
      .from('clip_plans')
      .select('plan_json')
      .eq('job_id', row.jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: clipRows } = await supabase
      .from('clips')
      .select('id, index, storage_path')
      .eq('job_id', row.jobId)
      .order('index');

    const { captionsVttDataUrl, clips, totalDurationS } = buildClipPayload(
      planRow?.plan_json,
      (clipRows ?? []) as Array<{ id: string; index: number }>,
    );

    // Smart regen is the path for general feedback when every clip is
    // checkpointed in Storage AND a clip_plan exists for Claude to
    // anchor on. Mirrors the eligibility check in submit-feedback.ts.
    const allClipsCheckpointed = (clipRows ?? []).length > 0
      && (clipRows ?? []).every((c) => !!(c as { storage_path: string | null }).storage_path);
    const smartRegenAvailable = !!planRow?.plan_json && allClipsCheckpointed;

    let feedbackText: string | null = null;
    if (row.isRegen) {
      const { data: fbRow } = await supabase
        .from('feedback')
        .select('text')
        .eq('applied_to_job_id', row.jobId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      feedbackText = (fbRow?.text as string | null) ?? null;
    }

    const costEstimateUsd = row.resolution && row.modelTier && totalDurationS > 0
      ? estimateSeedanceCost(totalDurationS, row.resolution, row.modelTier)
      : null;

    versionInfos.push({
      id: row.videoId,
      videoUrl: row.mp4Path ? publicVideoUrl(row.mp4Path) : null,
      thumbUrl: row.thumbPath ? publicVideoUrl(row.thumbPath) : null,
      captionsVttDataUrl,
      clips,
      costEstimateUsd,
      resolutionLabel: row.resolution,
      createdAt: row.createdAt,
      isRegen: row.isRegen,
      feedbackText,
      smartRegenAvailable,
    });
  }

  // Latest drives display panels (captions, cost, distribution status).
  // SELECTED drives action controls (publish toggle, schedule sheets) so
  // that "publish now" and "schedule" act on the version the user is
  // viewing, not silently on the latest. When no ?v= is set, selected
  // falls back to latest, so the default behavior is unchanged.
  const latestVersionInfo = versionInfos.length > 0 ? versionInfos[versionInfos.length - 1] : null;
  const latestJobId = latest?.jobId ?? null;
  const selectedRow = pickActiveVersion(versionRows, initialSelectedId);
  const videoId: string | null = selectedRow?.videoId ?? null;
  const videoPublishedToSite: boolean = selectedRow?.publishedToWebsite ?? false;
  const videoCostUsd = latest?.totalCostUsd ?? null;

  // Which platforms are actually wired up (Buffer + YouTube). Drives
  // the captions list (hide unconfigured) and the post-now sheet
  // (don't claim we'll post to channels that aren't connected).
  const connectedPlatforms = await getConnectedPlatforms();

  // Confirm-dialog context for the publish toggle: which version Yonah
  // is about to publish, and what (if anything) it'll replace on the
  // public site.
  const selectedRowIndex = selectedRow
    ? versionRows.findIndex((v) => v.videoId === selectedRow.videoId)
    : -1;
  const selectedVersionLabel = selectedRowIndex >= 0
    ? `Version ${selectedRowIndex + 1}`
    : 'Latest';
  const currentlyLiveSibling = selectedRow
    ? versionRows.find((v) => v.publishedToWebsite && v.videoId !== selectedRow.videoId) ?? null
    : null;
  const currentlyLiveSiblingIndex = currentlyLiveSibling
    ? versionRows.findIndex((v) => v.videoId === currentlyLiveSibling.videoId)
    : -1;
  const currentlyLiveSiblingLabel = currentlyLiveSiblingIndex >= 0
    ? `Version ${currentlyLiveSiblingIndex + 1}`
    : null;
  const publishReplacing = currentlyLiveSibling && currentlyLiveSiblingLabel
    ? { label: currentlyLiveSiblingLabel }
    : null;
  const selectedThumbUrl = selectedRow?.thumbPath
    ? publicVideoUrl(selectedRow.thumbPath)
    : null;

  // Also check for an in-flight job so the production arc reflects real state
  // AND so we can render the regen-in-progress banner above the page when one
  // exists. Status list mirrors modal_app.py's _IN_FLIGHT_STATUSES plus
  // 'queued' (which Modal treats as a fresh-trigger candidate but the user
  // experiences as in-flight). 'verifying' was missing from the previous
  // version of this query — added back so the arc + banner light up during
  // Gemini's per-clip visual-verify pass.
  const { data: activeJob } = await supabase
    .from('jobs')
    .select('id, status, status_message, triggered_at, regen_of_job_id')
    .eq('parsha_id', parsha.id)
    .in('status', ['queued', 'loading_parsha', 'generating_plan', 'uploading_refs', 'generating_clips', 'verifying', 'stitching'])
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const isGenerating = !!activeJob;
  // Only the regen banner (not first-time generation) is surfaced at the top
  // of the page — first-time generation already has its placeholder player
  // below. A regen is identified by regen_of_job_id being set.
  const inFlightRegen = activeJob && activeJob.regen_of_job_id
    ? {
        id: activeJob.id as string,
        status: activeJob.status as string,
        status_message: (activeJob.status_message as string | null) ?? null,
        triggered_at: (activeJob.triggered_at as string | null) ?? null,
        regen_of_job_id: (activeJob.regen_of_job_id as string | null) ?? null,
      }
    : null;

  // Compute the same p25-p75 typical run hint the /jobs/<id> page uses, so
  // the banner gives the user the same wait-time expectation that the
  // verbose progress page does.
  const { data: doneJobsForTiming } = await supabase
    .from('jobs')
    .select('triggered_at, completed_at')
    .eq('status', 'done')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(20);
  const typicalRun = computeTypicalRun(doneJobsForTiming ?? []);

  // Captions (per-platform copy) come from the LATEST job's clip_plan.
  const captions: Partial<Record<Platform, string>> = {};
  if (latestJobId) {
    const { data: latestPlanRow } = await supabase
      .from('clip_plans')
      .select('plan_json')
      .eq('job_id', latestJobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const planJson = (latestPlanRow?.plan_json ?? {}) as {
      captions?: {
        tiktok?: string;
        instagram?: string;
        youtube_title?: string;
        youtube_description?: string;
        facebook?: string;
        twitter?: string;
      };
    };
    const src = planJson.captions ?? {};
    if (src.tiktok) captions.tiktok = src.tiktok;
    if (src.instagram) captions.instagram = src.instagram;
    if (src.facebook) captions.facebook = src.facebook;
    if (src.twitter) captions.twitter = src.twitter;
    if (src.youtube_title || src.youtube_description) {
      const title = (src.youtube_title ?? '').trim();
      const desc = (src.youtube_description ?? '').trim();
      captions.youtube = title && desc ? `${title}\n${desc}` : (title || desc);
    }
  }

  // Fetch post statuses for last 7 days (latest video only — we don't post
  // older versions).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentPosts } = videoId
    ? await supabase
        .from('posts')
        .select('platform, status, scheduled_at, published_at, buffer_update_id')
        .eq('video_id', videoId)
        .gte('created_at', sevenDaysAgo)
    : { data: null };

  const postsByPlatform = Object.fromEntries(
    PLATFORMS.map((p) => [p, recentPosts?.find((post) => post.platform === p) ?? null]),
  ) as Record<Platform, typeof recentPosts extends (infer T)[] | null ? T | null : null>;

  // Buffer token presence
  const bufferConfigured = !!process.env.BUFFER_ACCESS_TOKEN;

  // Production arc state — derived from real job + post state.
  const anyPublished = PLATFORMS.some((p) => postsByPlatform[p]?.status === 'published');
  const anyScheduled = PLATFORMS.some((p) => postsByPlatform[p]?.status === 'scheduled');
  const anyPostsRow = !!recentPosts && recentPosts.length > 0;
  const arcScript = aTight ? 'done' : 'idle';
  const arcVideo = videoId ? 'done' : isGenerating ? 'running' : 'idle';
  const arcCaptions = (captions.tiktok || captions.instagram || captions.youtube) ? 'done' : 'idle';
  const arcSchedule = anyPublished ? 'done' : (anyScheduled || anyPostsRow) ? 'running' : 'idle';

  function wordCount(text: string | null | undefined): number {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  const words = wordCount(aTight?.draft_text);

  const hasAnyVideo = !!latestVersionInfo?.videoUrl && (latestVersionInfo?.clips.length ?? 0) > 0;

  return (
    <div className="stagger">

      {/* Bilingual header */}
      <header
        style={{
          marginBottom: '20px',
          paddingBottom: '24px',
          borderBottom: '1px solid var(--ink-100)',
        }}
      >
        {parsha.hebrew_name && (
          <div
            lang="he"
            dir="rtl"
            style={{
              fontFamily: 'var(--ff-hebrew)',
              fontSize: 'clamp(28px, 4vw, 42px)',
              fontWeight: 400,
              color: 'var(--ink-700)',
              lineHeight: 1,
              marginBottom: '16px',
              textAlign: 'right',
              direction: 'rtl',
            }}
          >
            {parsha.hebrew_name}
          </div>
        )}
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '10.5px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--cedar-600)',
            marginBottom: '8px',
          }}
        >
          {parsha.book}
        </div>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(36px, 6vw, 72px)',
            lineHeight: 0.96,
            letterSpacing: '-0.035em',
            color: 'var(--ink-900)',
            margin: 0,
            fontVariationSettings: '"opsz" 144, "SOFT" 20',
          }}
        >
          {parsha.name}
          <em style={{ fontStyle: 'italic', color: 'var(--cedar-600)', fontVariationSettings: '"opsz" 144, "SOFT" 70' }}>.</em>
        </h1>
        <div
          style={{
            marginTop: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '10px',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '14px',
            color: 'var(--ink-500)',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
          }}
        >
          <span>{aTight ? `Script A-tight · ${words} words` : 'No script yet'}</span>
          {videoId && (
            <span style={{ color: 'var(--ink-300)' }}>·</span>
          )}
          {videoId && <VideoReadyPill />}
          {videoId && <PostedStatusPill anyPublished={anyPublished} anyScheduled={anyScheduled} />}
          {videoId && (
            <PublishToSiteToggle
              videoId={videoId}
              initialPublished={videoPublishedToSite}
              parshaSlug={parsha.slug}
              variant="pill"
              versionLabel={selectedVersionLabel}
              parshaName={parsha.name}
              replacing={publishReplacing}
              thumbUrl={selectedThumbUrl}
            />
          )}
        </div>
      </header>

      {/* Production arc */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '18px',
          padding: '22px 28px',
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--linen-50)',
          marginBottom: '36px',
          fontFamily: 'var(--ff-display)',
          fontSize: '14.5px',
          fontStyle: 'italic',
          color: 'var(--ink-500)',
          fontVariationSettings: '"opsz" 14, "SOFT" 40',
          flexWrap: 'wrap',
        }}
      >
        <ArcStage done={arcScript === 'done'} label="Script · approved" />
        <ArcSep />
        <ArcStage
          done={arcVideo === 'done'}
          running={arcVideo === 'running'}
          label={arcVideo === 'running' ? 'Video · generating' : 'Video · generated'}
        />
        <ArcSep />
        <ArcStage done={arcCaptions === 'done'} label="Captions" />
        <ArcSep />
        <ArcStage done={arcSchedule === 'done'} running={arcSchedule === 'running'} label={anyPublished ? 'Published' : anyScheduled ? 'Scheduled' : 'Schedule'} />
      </div>

      {hasAnyVideo ? (
        <>
          {/* Direct entry to per-clip surgery + compose. The video page
              still hosts general feedback (broad strokes), but for
              targeted clip-by-clip work this is the canonical surface. */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              marginBottom: '16px', flexWrap: 'wrap',
            }}
          >
            <Link
              href={`/videos/${parsha.slug}/edit`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                fontFamily: 'var(--ff-body)', fontWeight: 500,
                fontSize: '13px', padding: '9px 18px', minHeight: '40px',
                borderRadius: '999px',
                border: '1px solid var(--navy-800)',
                background: 'var(--navy-800)',
                color: 'var(--linen-50)',
                textDecoration: 'none',
              }}
            >
              Edit clips →
            </Link>
            <span
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '13px',
                color: 'var(--ink-500)',
                fontVariationSettings: '"opsz" 14, "SOFT" 50',
              }}
            >
              Fix one clip at a time, or stitch the best version of each
              clip together.
            </span>
          </div>

          {/* Video player + version selector + per-clip feedback list +
              general feedback box. The VideoVersionsView client component
              owns version state (?v=<videoId>) and compare mode (?compare=1)
              so URLs are shareable; the underlying VideoFeedback contract
              is unchanged. */}
          <VideoVersionsView
            versions={versionInfos}
            initialSelectedId={initialSelectedId}
            initialCompare={initialCompare}
            inFlightRegen={inFlightRegen}
            typicalRun={typicalRun}
          />
          {/* Script carousel — full width below the feedback row when we
              already have a video, so Yonah can still flip through script
              variants without losing the player + feedback context. */}
          <div style={{ marginBottom: '32px' }}>
            <ScriptCarousel
              parshaId={parsha.id}
              parshaName={parsha.name}
              defaultTierKey={defaultTierKey}
              scripts={parsha.scripts ?? []}
            />
          </div>
        </>
      ) : (
        <>
          {/* Pre-video state: no clip list yet, so keep the original
              placeholder/generating-state player on the left and the
              ScriptCarousel on the right. Feedback UI only makes sense
              once there's a video to react to. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '280px 1fr',
              gap: '32px',
              marginBottom: '32px',
              alignItems: 'start',
            }}
            className="row-video-script"
          >
            <div
              style={{
                position: 'relative',
                width: '280px',
                borderRadius: 'var(--r-lg)',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-page)',
                background: 'var(--ink-900)',
              }}
            >
              {latestVersionInfo?.videoUrl ? (
                <video
                  src={latestVersionInfo.videoUrl}
                  poster={latestVersionInfo.thumbUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  crossOrigin={latestVersionInfo.captionsVttDataUrl ? 'anonymous' : undefined}
                  style={{
                    width: '100%',
                    aspectRatio: '9 / 16',
                    display: 'block',
                    background: 'var(--ink-900)',
                  }}
                >
                  {latestVersionInfo.captionsVttDataUrl && (
                    <track
                      kind="captions"
                      srcLang="en"
                      label="English"
                      default
                      src={latestVersionInfo.captionsVttDataUrl}
                    />
                  )}
                </video>
              ) : (
                <div
                  style={{
                    aspectRatio: '9 / 16',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    background: isGenerating ? 'var(--navy-800)' : 'var(--ink-800)',
                    color: 'var(--linen-50)',
                    fontFamily: 'var(--ff-display)',
                    fontStyle: 'italic',
                    fontSize: '13px',
                    textAlign: 'center',
                    padding: '24px',
                    fontVariationSettings: '"opsz" 16, "SOFT" 50',
                  }}
                >
                  {isGenerating ? (
                    <span>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: 'var(--linen-50)',
                          marginRight: 8,
                          animation: 'pulse-navy 1.8s ease-in-out infinite',
                        }}
                      />
                      Generating…
                      <br />
                      <a
                        href={`/jobs/${activeJob?.id}`}
                        style={{
                          color: 'var(--linen-50)',
                          textDecoration: 'underline',
                          textDecorationColor: 'rgba(250,244,232,.4)',
                          fontSize: '11.5px',
                          opacity: 0.8,
                        }}
                      >
                        view progress →
                      </a>
                    </span>
                  ) : (
                    <span style={{ opacity: 0.6 }}>No video yet.<br />Approve a script to start.</span>
                  )}
                </div>
              )}
              {latestVersionInfo?.videoUrl && (
                <div style={{ display: 'flex', gap: '6px', padding: '10px 12px', background: 'var(--ink-800)' }}>
                  <a
                    href={latestVersionInfo.videoUrl}
                    download
                    style={{
                      flex: 1,
                      minHeight: '38px',
                      fontFamily: 'var(--ff-body)',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: 'var(--linen-100)',
                      background: 'rgba(250,244,232,.08)',
                      border: '1px solid rgba(250,244,232,.12)',
                      borderRadius: '999px',
                      letterSpacing: '0.02em',
                      transition: 'all var(--trans)',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    Download
                  </a>
                </div>
              )}
            </div>
            <ScriptCarousel
              parshaId={parsha.id}
              parshaName={parsha.name}
              defaultTierKey={defaultTierKey}
              scripts={parsha.scripts ?? []}
            />
          </div>
        </>
      )}

      {/* ROW 2: Captions + Distribution. Mirrors ROW 1's narrow|wide split
          (video 280 | script 1fr), flipped — captions (wide content) on
          the left aligning with the script column above, distribution
          (compact status list) on the right at the same 280px footprint
          as the video player above. minmax(0,1fr) keeps long captions
          from busting the grid. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 280px',
          gap: '20px',
          marginBottom: '32px',
        }}
        className="row-caps-dist"
      >
        {/* Captions panel */}
        <div
          style={{
            padding: '24px 26px',
            border: '1px solid var(--ink-100)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--linen-50)',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--ff-display)',
              fontWeight: 500,
              fontSize: '15px',
              color: 'var(--ink-900)',
              margin: '0 0 4px 0',
              fontVariationSettings: '"opsz" 18, "SOFT" 30',
            }}
          >
            Captions
          </h2>
          <p
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '12.5px',
              color: 'var(--ink-400)',
              margin: '0 0 18px 0',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
            }}
          >
            Per-platform preview
          </p>
          <CaptionsList
            jobId={latestJobId}
            captions={captions}
            parshaSlug={parsha.slug}
            connectedPlatforms={connectedPlatforms}
          />
        </div>

        {/* Distribution panel */}
        <div
          style={{
            padding: '24px 26px',
            border: '1px solid var(--ink-100)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--linen-50)',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--ff-display)',
              fontWeight: 500,
              fontSize: '15px',
              color: 'var(--ink-900)',
              margin: '0 0 4px 0',
              fontVariationSettings: '"opsz" 18, "SOFT" 30',
            }}
          >
            Distribution
          </h2>
          <p
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '12.5px',
              color: 'var(--ink-400)',
              margin: '0 0 18px 0',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
            }}
          >
            Status per channel
          </p>
          {(
            [
              { platform: 'tiktok' as const, name: 'TikTok' },
              { platform: 'instagram' as const, name: 'Instagram' },
              { platform: 'youtube' as const, name: 'YouTube' },
              { platform: 'facebook' as const, name: 'Facebook' },
              { platform: 'twitter' as const, name: 'X' },
            ].map(({ platform, name }) => {
              const post = postsByPlatform[platform];
              let status = 'Not scheduled';
              let live = false;
              if (post) {
                if (post.status === 'published') { status = 'Published'; live = true; }
                else if (post.status === 'scheduled' && post.scheduled_at) {
                  const d = new Date(post.scheduled_at);
                  status = `Scheduled ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
                } else if (post.status === 'failed') { status = 'Failed'; }
                else { status = 'Pending'; }
              }
              return { platform, name, status, live };
            })
          ).map(({ platform, name, status, live }) => (
            <div
              key={platform}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 0',
                borderBottom: '1px dotted var(--ink-100)',
                fontSize: '14px',
                minHeight: '44px',
              }}
            >
              <span style={{ width: '22px', height: '22px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-500)' }}>
                <PlatformIcon name={platform} size={18} />
              </span>
              <span style={{ fontWeight: 500, color: 'var(--ink-900)', flexShrink: 0 }}>{name}</span>
              <span
                style={{
                  color: live ? 'var(--jade)' : 'var(--ink-500)',
                  fontSize: '13px',
                  marginLeft: 'auto',
                  textAlign: 'right',
                }}
              >
                {status}
              </span>
            </div>
          ))}
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'stretch' }}>
            {videoId ? (
              <>
                <PublishToSiteToggle
                  videoId={videoId}
                  initialPublished={videoPublishedToSite}
                  parshaSlug={parsha.slug}
                  versionLabel={selectedVersionLabel}
                  parshaName={parsha.name}
                  replacing={publishReplacing}
                  thumbUrl={selectedThumbUrl}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
                  <ScheduleAllSheet
                    videoId={videoId}
                    captions={captions}
                    bufferConfigured={bufferConfigured}
                    mode="now"
                    alreadyPublishedToWebsite={videoPublishedToSite}
                    parshaSlug={parsha.slug}
                    connectedPlatforms={connectedPlatforms}
                    versionLabel={selectedVersionLabel}
                    parshaName={parsha.name}
                  />
                  <ScheduleAllSheet
                    videoId={videoId}
                    captions={captions}
                    bufferConfigured={bufferConfigured}
                    mode="schedule"
                    variant="secondary"
                    parshaSlug={parsha.slug}
                    connectedPlatforms={connectedPlatforms}
                    versionLabel={selectedVersionLabel}
                    parshaName={parsha.name}
                  />
                </div>
              </>
            ) : (
              <button
                type="button"
                disabled
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '8px',
                  fontFamily: 'var(--ff-body)', fontWeight: 500, fontSize: '14px',
                  padding: '11px 22px', minHeight: '44px', borderRadius: '999px',
                  border: '1px solid var(--navy-800)', background: 'var(--navy-800)',
                  color: 'var(--linen-50)', opacity: 0.5, cursor: 'not-allowed',
                }}
              >
                Schedule all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cost whisper — real job cost when available */}
      {videoCostUsd !== null && (
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '12.5px',
          color: 'var(--ink-300)',
          marginBottom: '36px',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        This video cost ${videoCostUsd.toFixed(2)} to produce.
      </p>
      )}

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: '28px',
          borderTop: '1px solid var(--ink-100)',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <Link
          href="/videos"
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '14px',
            color: 'var(--ink-500)',
            textDecoration: 'none',
            minHeight: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            transition: 'color var(--trans)',
          }}
        >
          ← Back to videos
        </Link>
        <button
          type="button"
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--tassel)',
            opacity: 0.6,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            minHeight: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            transition: 'opacity var(--trans)',
          }}
        >
          Delete this video
        </button>
      </div>
    </div>
  );
}

// Helpers

function ArcStage({ done = false, running = false, label }: { done?: boolean; running?: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
      <span
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: done ? 'var(--jade)' : running ? 'var(--navy-700)' : 'transparent',
          border: done ? '1.5px solid var(--jade)' : running ? '1.5px solid var(--navy-700)' : '1.5px solid var(--ink-200)',
          display: 'inline-block',
          animation: running ? 'pulse-navy 1.8s ease-in-out infinite' : undefined,
        }}
      />
      <span
        style={{
          color: done ? 'var(--ink-700)' : running ? 'var(--ink-900)' : undefined,
          fontStyle: running ? 'normal' : undefined,
          fontWeight: running ? 500 : undefined,
          fontFamily: running ? 'var(--ff-body)' : undefined,
        }}
      >
        {label}
      </span>
    </span>
  );
}

function ArcSep() {
  return (
    <span style={{ fontFamily: 'var(--ff-display)', color: 'var(--ink-200)', fontStyle: 'normal', fontSize: '13px' }}>
      —
    </span>
  );
}

function pillStyle(bg: string, color: string, dot: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--ff-body)',
    fontStyle: 'normal',
    fontWeight: 500,
    fontSize: '11.5px',
    padding: '4px 12px 4px 8px',
    borderRadius: '999px',
    letterSpacing: '0.01em',
    background: bg,
    color,
    // Inline so the pill can sit alongside the italic script-line text without
    // inheriting its font style.
    '--pill-dot': dot,
  } as React.CSSProperties;
}

function VideoReadyPill() {
  return (
    <span style={pillStyle('rgba(46,125,94,.12)', 'var(--jade)', 'var(--jade)')}>
      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--jade)', flexShrink: 0 }} />
      Video ready
    </span>
  );
}

/** p25–p75 of recent successful runs, matching the helper in
 *  /jobs/[id]/page.tsx so the regen banner here shows the same "typical
 *  run" hint. Duplicated rather than imported to avoid a shared-server-util
 *  module for a six-line function. */
function computeTypicalRun(
  rows: { triggered_at: string | null; completed_at: string | null }[],
): { lowMin: number; highMin: number } | null {
  const durations: number[] = [];
  for (const r of rows) {
    if (!r.triggered_at || !r.completed_at) continue;
    const seconds =
      (new Date(r.completed_at).getTime() - new Date(r.triggered_at).getTime()) / 1000;
    // Sanity-bound: ignore obviously bad rows (clock skew, schema migration, etc).
    if (seconds < 30 || seconds > 60 * 60) continue;
    durations.push(seconds);
  }
  if (durations.length < 3) return null;
  durations.sort((a, b) => a - b);
  const p25 = durations[Math.floor(durations.length * 0.25)];
  const p75 = durations[Math.floor(durations.length * 0.75)];
  return {
    lowMin: Math.max(1, Math.round(p25 / 60)),
    highMin: Math.max(1, Math.round(p75 / 60)),
  };
}

function PostedStatusPill({ anyPublished, anyScheduled }: { anyPublished: boolean; anyScheduled: boolean }) {
  if (anyPublished) {
    return (
      <span style={pillStyle('rgba(46,125,94,.12)', 'var(--jade)', 'var(--jade)')}>
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--jade)', flexShrink: 0 }} />
        Posted
      </span>
    );
  }
  if (anyScheduled) {
    return (
      <span style={pillStyle('var(--navy-wash)', 'var(--navy-700)', 'var(--navy-700)')}>
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--navy-700)', flexShrink: 0 }} />
        Scheduled
      </span>
    );
  }
  return (
    <span style={pillStyle('rgba(140,125,100,.08)', 'var(--ink-500)', 'var(--ink-300)')}>
      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--ink-300)', flexShrink: 0 }} />
      Not posted
    </span>
  );
}
