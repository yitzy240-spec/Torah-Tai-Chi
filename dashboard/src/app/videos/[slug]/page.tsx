import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformIcon } from '@/components/platform-icon';
import { ScheduleAllSheet } from '@/components/schedule-all-sheet';
import { CaptionsList } from '@/components/captions-list';
import { PublishToSiteToggle } from '@/components/publish-to-site-toggle';
import { ScriptCarousel } from '@/components/script-carousel';
import { VideoFeedback, type FeedbackClip } from '@/components/video-feedback';
import { PLATFORMS, type Platform } from '@/lib/platforms';
import { publicVideoUrl } from '@/lib/storage-url';
import { estimateSeedanceCost, type Resolution, type ModelTier } from '@/lib/seedance-pricing';

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
}


export default async function VideoDetailPage({ params }: PageProps) {
  const { slug } = await params;
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

  // Fetch most recent DONE job for this parsha, including the video + cost.
  const { data: latestJob } = await supabase
    .from('jobs')
    .select('id, resolution, model_tier, total_cost_usd, videos(id, mp4_path, thumb_path, published_to_website)')
    .eq('parsha_id', parsha.id)
    .eq('status', 'done')
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const jobResolution = (latestJob?.resolution as Resolution | null) ?? null;
  const jobModelTier = (latestJob?.model_tier as ModelTier | null) ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videosRel = latestJob?.videos as any;
  const video = (Array.isArray(videosRel) ? videosRel[0] : videosRel) ?? null;
  const videoId: string | null = video?.id ?? null;
  const videoUrl: string | null = video?.mp4_path ? publicVideoUrl(video.mp4_path) : null;
  const thumbUrl: string | null = video?.thumb_path ? publicVideoUrl(video.thumb_path) : null;
  const videoPublishedToSite: boolean = !!video?.published_to_website;
  const videoCostUsd = (latestJob?.total_cost_usd as number | null) ?? null;

  // Also check for an in-flight job so the production arc reflects real state.
  const { data: activeJob } = await supabase
    .from('jobs')
    .select('id, status')
    .eq('parsha_id', parsha.id)
    .in('status', ['queued', 'loading_parsha', 'generating_plan', 'uploading_refs', 'generating_clips', 'stitching'])
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const isGenerating = !!activeJob;

  // Pull real captions + clip-level voiceover from the clip_plan saved by
  // Modal after generation. The captions feed the per-platform preview;
  // the clip voiceovers + durations feed the in-player WebVTT track.
  let captions: Partial<Record<Platform, string>> = {};
  let captionsVttDataUrl: string | null = null;
  let feedbackClips: FeedbackClip[] = [];
  let totalDurationS = 0;
  if (latestJob?.id) {
    const { data: planRow } = await supabase
      .from('clip_plans')
      .select('plan_json')
      .eq('job_id', latestJob.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const planJson = (planRow?.plan_json ?? {}) as {
      captions?: {
        tiktok?: string;
        instagram?: string;
        youtube_title?: string;
        youtube_description?: string;
        facebook?: string;
        twitter?: string;
      };
      clips?: Array<{ voiceover?: string; duration_s?: number; index?: number }>;
    };
    // Build a WebVTT data URL from the per-clip voiceovers so the <video>
    // can render closed captions. Cumulative time offsets from duration_s.
    if (Array.isArray(planJson.clips) && planJson.clips.length > 0) {
      const orderedClips = [...planJson.clips].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const fmt = (s: number): string => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s - h * 3600 - m * 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
      };
      let cur = 0;
      const cues: string[] = [];
      for (const c of orderedClips) {
        const dur = c.duration_s ?? 0;
        const text = (c.voiceover ?? '').trim();
        if (dur > 0 && text) {
          cues.push(`${fmt(cur)} --> ${fmt(cur + dur)}\n${text}`);
        }
        cur += dur;
      }
      if (cues.length > 0) {
        const vtt = 'WEBVTT\n\n' + cues.join('\n\n') + '\n';
        captionsVttDataUrl = `data:text/vtt;charset=utf-8;base64,${Buffer.from(vtt, 'utf-8').toString('base64')}`;
      }

      // Build FeedbackClip[] for the per-clip feedback UI. We need the real
      // clip rows (for the FK clip_id) joined with the plan's voiceover +
      // duration. Plan is the source of truth for voiceover/duration; the
      // clips table is the source for stable UUIDs.
      const { data: clipRows } = await supabase
        .from('clips')
        .select('id, index')
        .eq('job_id', latestJob.id)
        .order('index');
      const idByIndex = new Map<number, string>(
        (clipRows ?? []).map((r) => [r.index as number, r.id as string]),
      );
      let cursorS = 0;
      for (const c of orderedClips) {
        const dur = c.duration_s ?? 0;
        const idx = c.index ?? 0;
        const id = idByIndex.get(idx);
        const start = cursorS;
        cursorS += dur;
        if (!id) continue; // no matching clip row — skip rather than make up an id
        feedbackClips.push({
          id,
          voiceover: (c.voiceover ?? '').trim(),
          startS: start,
          endS: cursorS,
        });
      }
      totalDurationS = cursorS;
    }
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

  // Fetch post statuses for last 7 days
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

  // Cost preview for the regen submit button — same helper that the
  // compose flow uses. If we don't have duration yet (e.g. plan_json
  // missing), VideoFeedback falls back to a coarse range based on
  // resolution alone.
  const costEstimateUsd = jobResolution && jobModelTier && totalDurationS > 0
    ? estimateSeedanceCost(totalDurationS, jobResolution, jobModelTier)
    : null;

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

      {videoUrl && feedbackClips.length > 0 ? (
        <>
          {/* Video player + per-clip feedback list + general feedback box.
              Voiceover-driven — Yonah identifies clips by what Rav Eli says,
              not by index. Submitting any feedback redirects to the new
              regen job's progress page. */}
          <VideoFeedback
            videoId={videoId}
            videoUrl={videoUrl}
            thumbUrl={thumbUrl}
            captionsVttDataUrl={captionsVttDataUrl}
            clips={feedbackClips}
            costEstimateUsd={costEstimateUsd}
            resolutionLabel={jobResolution}
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
              {videoUrl ? (
                <video
                  src={videoUrl}
                  poster={thumbUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  crossOrigin={captionsVttDataUrl ? 'anonymous' : undefined}
                  style={{
                    width: '100%',
                    aspectRatio: '9 / 16',
                    display: 'block',
                    background: 'var(--ink-900)',
                  }}
                >
                  {captionsVttDataUrl && (
                    <track
                      kind="captions"
                      srcLang="en"
                      label="English"
                      default
                      src={captionsVttDataUrl}
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
              {videoUrl && (
                <div style={{ display: 'flex', gap: '6px', padding: '10px 12px', background: 'var(--ink-800)' }}>
                  <a
                    href={videoUrl}
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
            jobId={latestJob?.id ?? null}
            captions={captions}
            parshaSlug={parsha.slug}
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
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
                  <ScheduleAllSheet
                    videoId={videoId}
                    captions={captions}
                    bufferConfigured={bufferConfigured}
                    mode="now"
                  />
                  <ScheduleAllSheet
                    videoId={videoId}
                    captions={captions}
                    bufferConfigured={bufferConfigured}
                    mode="schedule"
                    variant="secondary"
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
