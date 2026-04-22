import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformIcon } from '@/components/platform-icon';
import { ScheduleAllSheet } from '@/components/schedule-all-sheet';
import { ScriptCarousel } from '@/components/script-carousel';
import { PLATFORMS, type Platform } from '@/lib/platforms';
import { publicVideoUrl } from '@/lib/storage-url';

interface Script {
  id: string;
  option: string;
  title: string | null;
  tldr: string | null;
  draft_text: string | null;
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
    .select('id, order, name, book, slug, hebrew_name, scripts(id, option, title, tldr, draft_text, motion_ref_slug)')
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

  // Fetch most recent DONE job for this parsha, including the video + cost.
  const { data: latestJob } = await supabase
    .from('jobs')
    .select('id, resolution, model_tier, total_cost_usd, videos(id, mp4_path, thumb_path)')
    .eq('parsha_id', parsha.id)
    .eq('status', 'done')
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videosRel = latestJob?.videos as any;
  const video = (Array.isArray(videosRel) ? videosRel[0] : videosRel) ?? null;
  const videoId: string | null = video?.id ?? null;
  const videoUrl: string | null = video?.mp4_path ? publicVideoUrl(video.mp4_path) : null;
  const thumbUrl: string | null = video?.thumb_path ? publicVideoUrl(video.thumb_path) : null;
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
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '14px',
            color: 'var(--ink-500)',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
          }}
        >
          {aTight ? `Script A-tight · ${words} words` : 'No script yet'}
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

      {/* ROW 1: Video player + Script panel */}
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
        {/* Phone-frame video player — real <video> when we have mp4,
            generating-state placeholder while a job is in flight, empty
            state otherwise. */}
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
              // crossOrigin needed so the browser will load a <track>
              // alongside a cross-origin (Supabase Storage) video src.
              // Supabase public buckets serve Access-Control-Allow-Origin: *.
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
            <div
              style={{
                display: 'flex',
                gap: '6px',
                padding: '10px 12px',
                background: 'var(--ink-800)',
              }}
            >
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

        {/* Script carousel — arrow through A / B / C / A-tight / custom variants */}
        <ScriptCarousel
          parshaId={parsha.id}
          parshaName={parsha.name}
          scripts={parsha.scripts ?? []}
        />
      </div>

      {/* Regen box — full width */}
      <div
        style={{
          padding: '28px 32px',
          border: '1px solid var(--cedar-300)',
          borderRadius: 'var(--r-lg)',
          background: 'linear-gradient(180deg, rgba(240,223,193,.3) 0%, var(--linen-50) 100%)',
          marginBottom: '28px',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '18px',
            margin: '0 0 6px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 22, "SOFT" 30',
          }}
        >
          What would you change?
        </h3>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '13.5px',
            color: 'var(--ink-500)',
            margin: '0 0 16px 0',
            fontVariationSettings: '"opsz" 14, "SOFT" 60',
          }}
        >
          Describe what felt off. Claude will identify which clips to adjust and show you the plan before anything regenerates.
        </p>
        <textarea
          placeholder="The desert scene felt rushed, and Rav Eli's gesture in clip 3 didn't match the gravity of the line..."
          style={{
            width: '100%',
            minHeight: '88px',
            padding: '16px 18px',
            border: '1px solid var(--ink-200)',
            borderRadius: 'var(--r-md)',
            background: 'var(--linen-50)',
            fontFamily: 'var(--ff-body)',
            fontSize: '15px',
            color: 'var(--ink-900)',
            resize: 'vertical',
            lineHeight: 1.55,
            outline: 'none',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            marginTop: '14px',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '13px',
              color: 'var(--ink-400)',
              lineHeight: 1.45,
              fontVariationSettings: '"opsz" 14, "SOFT" 60',
              flex: 1,
              minWidth: '240px',
            }}
          >
            Typical regen costs ~$1.20 per clip. You&apos;ll see the estimate before committing.
          </div>
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: '14px',
              padding: '11px 22px',
              minHeight: '44px',
              borderRadius: '999px',
              border: '1px solid var(--ink-200)',
              background: 'transparent',
              color: 'var(--ink-700)',
              cursor: 'pointer',
              transition: 'all var(--trans)',
            }}
          >
            Submit feedback
          </button>
        </div>
      </div>

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
          {PLATFORMS.map((platform) => ({
            platform,
            caption: captions[platform] ?? null,
          })).filter(({ caption }) => caption).map(({ platform, caption }) => (
            <div
              key={platform}
              style={{
                padding: '12px 14px',
                border: '1px solid var(--ink-100)',
                borderRadius: 'var(--r-md)',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
              }}
            >
              <span style={{ width: '22px', height: '22px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-500)' }}>
                <PlatformIcon name={platform} size={18} />
              </span>
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--ink-700)',
                  flex: 1,
                  minWidth: 0,
                  lineHeight: 1.45,
                  overflowWrap: 'anywhere',
                }}
              >
                {caption}
              </span>
              <button
                type="button"
                style={{
                  fontSize: '12px',
                  color: 'var(--ink-400)',
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--ink-200)',
                  textUnderlineOffset: '3px',
                  cursor: 'pointer',
                  flexShrink: 0,
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                }}
              >
                Edit
              </button>
            </div>
          ))}
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
          <div style={{ marginTop: '16px' }}>
            {videoId ? (
              <ScheduleAllSheet
                videoId={videoId}
                captions={captions}
                bufferConfigured={bufferConfigured}
              />
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
