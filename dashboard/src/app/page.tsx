import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getCanonicalClipPlan } from '@/lib/clip-plan';
import { StanceToggle } from '@/components/stance-toggle';
import { Fab } from '@/components/fab';
import { getThisWeekParsha, getUpcomingHolidays, HEBCAL_TO_SLUG } from '@/lib/hebcal';
import Link from 'next/link';
import { GenerateDialog } from '@/components/generate-dialog';
import { checkHealth } from '@/lib/health';
import { SystemHealthStrip } from '@/components/system-health';
import { ScriptCarousel, type CarouselScript } from '@/components/script-carousel';
import { TodayPostingPanel, type PostState } from '@/components/today-posting-panel';
import { getStance } from '@/lib/stance';
import { publicVideoUrl } from '@/lib/storage-url';
import type { Platform } from '@/lib/platforms';
import { PLATFORMS } from '@/lib/platforms';

async function SystemHealthAsync() {
  const health = await checkHealth();
  return <SystemHealthStrip health={health} />;
}

function SystemHealthSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{
        fontFamily: 'var(--ff-display)',
        fontStyle: 'italic',
        fontSize: '12.5px',
        color: 'var(--ink-300)',
        marginBottom: '28px',
        lineHeight: 1.5,
      }}
    >
      <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: 'var(--ink-200)', marginRight: '7px', verticalAlign: 'middle' }} />
      Checking systems…
    </div>
  );
}

// Types
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
  scripts: Script[];
}

async function getNextParsha(): Promise<Parsha | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('parshiot')
    .select('id, order, name, book, slug, scripts(id, option, title, tldr, draft_text, director_notes, motion_ref_slug)')
    .order('order')
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as Parsha;
}

type ArcStageState = 'idle' | 'running' | 'done';
interface ProductionArc {
  script: ArcStageState;
  video: ArcStageState;
  captions: ArcStageState;
  schedule: ArcStageState;
  videoLabel: string;
  scheduleLabel: string;
}

const IN_FLIGHT_STATUSES = new Set([
  'queued', 'loading_parsha', 'generating_plan', 'uploading_refs',
  'generating_clips', 'stitching',
]);

async function computeProductionArc(parshaId: string | undefined): Promise<ProductionArc> {
  const fallback: ProductionArc = {
    script: 'idle', video: 'idle', captions: 'idle', schedule: 'idle',
    videoLabel: 'Video', scheduleLabel: 'Schedule',
  };
  if (!parshaId) return fallback;
  const supabase = await createClient();

  // Latest job for this parsha (any status)
  const { data: latestJob } = await supabase
    .from('jobs')
    .select('id, status, videos(id)')
    .eq('parsha_id', parshaId)
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videoRel = latestJob?.videos as any;
  const video = (Array.isArray(videoRel) ? videoRel[0] : videoRel) ?? null;
  const videoId: string | null = video?.id ?? null;

  // Captions presence — pulled from the canonical clip_plan for the
  // parsha (job-tree walk so regen/compose jobs see the original
  // pipeline run's captions).
  let captionsPresent = false;
  if (latestJob?.id) {
    const plan = await getCanonicalClipPlan(supabase, latestJob.id);
    const planJson = (plan?.planJson ?? {}) as { captions?: Record<string, string> };
    captionsPresent = !!(planJson.captions && Object.keys(planJson.captions).length > 0);
  }

  // Posts state for this video
  let anyPublished = false;
  let anyScheduled = false;
  if (videoId) {
    const { data: posts } = await supabase
      .from('posts')
      .select('status')
      .eq('video_id', videoId);
    anyPublished = (posts ?? []).some((p) => p.status === 'published');
    anyScheduled = (posts ?? []).some((p) => p.status === 'scheduled');
  }

  const arc: ProductionArc = { ...fallback };
  // Script — script ready iff parsha has any script (we know we're rendering one)
  arc.script = 'done';
  // Video
  if (latestJob && IN_FLIGHT_STATUSES.has(latestJob.status as string)) {
    arc.video = 'running';
    arc.videoLabel = 'Video · generating';
  } else if (videoId) {
    arc.video = 'done';
    arc.videoLabel = 'Video · ready';
  } else {
    arc.video = 'idle';
    arc.videoLabel = 'Video · awaiting your go';
  }
  // Captions
  arc.captions = captionsPresent ? 'done' : 'idle';
  // Schedule
  if (anyPublished) {
    arc.schedule = 'done';
    arc.scheduleLabel = 'Published';
  } else if (anyScheduled) {
    arc.schedule = 'running';
    arc.scheduleLabel = 'Scheduled';
  } else {
    arc.schedule = 'idle';
    arc.scheduleLabel = 'Schedule';
  }
  return arc;
}

interface PostingData {
  jobId: string;
  videoId: string;
  videoUrl: string | null;
  thumbUrl: string | null;
  videoCostUsd: number | null;
  chosenScriptOption: string | null;
  publishedToSite: boolean;
  captions: Partial<Record<Platform, string>>;
  postsByPlatform: Partial<Record<Platform, PostState | null>>;
}

/**
 * Fetch everything <TodayPostingPanel> needs when a parsha has a done video.
 * Returns null when there's no done job yet — caller falls back to the
 * regular ScriptCarousel UX.
 */
async function loadPostingData(parshaId: string): Promise<PostingData | null> {
  const supabase = await createClient();

  // Pull every done job + its video for this parsha. We need to pick
  // the one whose state actually drives the homepage — the published
  // version if any, else the latest draft. Reading just the latest
  // row meant the Today panel showed 'Not posted / Off site / Not
  // scheduled' for parshiot whose posts went out from an older version.
  const { data: doneJobs } = await supabase
    .from('jobs')
    .select(
      'id, status, script_id, total_cost_usd, triggered_at, ' +
      'videos(id, mp4_path, thumb_path, published_to_website), ' +
      'scripts(option)',
    )
    .eq('parsha_id', parshaId)
    .eq('status', 'done')
    .order('triggered_at', { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (doneJobs ?? []).flatMap((j: any) => {
    const v = (Array.isArray(j.videos) ? j.videos[0] : j.videos) ?? null;
    if (!v?.id) return [];
    return [{ job: j, video: v }];
  });
  if (rows.length === 0) return null;

  // Published version wins. Falls back to latest done job when nothing
  // is published yet (the original behavior, preserved for first-runs).
  const chosen = rows.find((r) => !!r.video.published_to_website) ?? rows[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestJob = chosen.job as any;
  const video = chosen.video;
  const videoId: string = video.id;

  const scriptRel = latestJob.scripts;
  const scriptRow = (Array.isArray(scriptRel) ? scriptRel[0] : scriptRel) ?? null;
  const chosenScriptOption: string | null = scriptRow?.option ?? null;

  // Captions live in the canonical clip_plan's plan_json. Job-tree walk
  // so regen/compose jobs find the original pipeline run's plan.
  const plan = await getCanonicalClipPlan(supabase, latestJob.id);
  const planJson = (plan?.planJson ?? {}) as {
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
  const captions: Partial<Record<Platform, string>> = {};
  if (src.tiktok) captions.tiktok = src.tiktok;
  if (src.instagram) captions.instagram = src.instagram;
  if (src.facebook) captions.facebook = src.facebook;
  if (src.twitter) captions.twitter = src.twitter;
  if (src.youtube_title || src.youtube_description) {
    const title = (src.youtube_title ?? '').trim();
    const desc = (src.youtube_description ?? '').trim();
    captions.youtube = title && desc ? `${title}\n${desc}` : (title || desc);
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // ORDER BY created_at DESC so the .find() below grabs the LATEST
  // attempt per platform. Without this, a failed first attempt sticks
  // in the UI even after a successful retry — we keep both rows in
  // posts for audit but only the freshest matters for status display.
  const { data: recentPosts } = await supabase
    .from('posts')
    .select('platform, status, scheduled_at, published_at, created_at')
    .eq('video_id', videoId)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false });
  const postsByPlatform: Partial<Record<Platform, PostState | null>> = {};
  for (const p of PLATFORMS) {
    const row = (recentPosts ?? []).find((r) => r.platform === p);
    postsByPlatform[p] = row
      ? { status: row.status, scheduled_at: row.scheduled_at, published_at: row.published_at }
      : null;
  }

  return {
    jobId: String(latestJob.id),
    videoId,
    videoUrl: video?.mp4_path ? publicVideoUrl(video.mp4_path) : null,
    thumbUrl: video?.thumb_path ? publicVideoUrl(video.thumb_path) : null,
    videoCostUsd: latestJob.total_cost_usd != null ? Number(latestJob.total_cost_usd) : null,
    chosenScriptOption,
    publishedToSite: !!video?.published_to_website,
    captions,
    postsByPlatform,
  };
}

async function getParshaBySlug(slug: string): Promise<Parsha | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('parshiot')
    .select('id, order, name, book, slug, scripts(id, option, title, tldr, draft_text, director_notes, motion_ref_slug)')
    .eq('slug', slug)
    .single();

  if (error || !data) return null;
  return data as Parsha;
}

export default async function TodayPage() {
  // Feature A: use Hebcal live parsha; fall back to first-ordered parsha from DB
  // checkHealth is intentionally NOT awaited here — it pings 5 external
  // services and would hold the whole page back. We render it inside a
  // Suspense boundary below so the rest of the page appears immediately.
  const [hebcalParsha, fallbackParsha, stance, upcomingHolidays] = await Promise.all([
    getThisWeekParsha(),
    getNextParsha(),
    getStance(),
    getUpcomingHolidays(21),
  ]);

  // Surface the next holiday within 21 days only if a matching parshiot row
  // exists (otherwise there's nothing to click into).
  let upcomingHoliday: { slug: string; name: string; hebrew: string; date: string; days: number } | null = null;
  if (upcomingHolidays.length > 0) {
    const supabase = await createClient();
    const slugs = upcomingHolidays.map((h) => h.slug);
    const { data: rows } = await supabase.from('parshiot').select('slug').in('slug', slugs);
    const seeded = new Set((rows ?? []).map((r) => r.slug));
    const today = new Date().toISOString().slice(0, 10);
    for (const h of upcomingHolidays) {
      if (!seeded.has(h.slug)) continue;
      const days = Math.round(
        (new Date(h.date + 'T12:00:00').getTime() -
          new Date(today + 'T12:00:00').getTime()) / 86400000
      );
      upcomingHoliday = { ...h, days };
      break;
    }
  }

  // Combined-parsha pair: when Hebcal says this Shabbat is e.g.
  // "Achrei Mot-Kedoshim", fetch the partner's scripts too so Yonah
  // can pick a script from EITHER parsha (or merge concepts) before
  // generating one combined video.
  const partnerSlug = hebcalParsha?.combined
    ? HEBCAL_TO_SLUG[hebcalParsha.combined] ?? null
    : null;
  const partnerParsha: Parsha | null = partnerSlug
    ? await getParshaBySlug(partnerSlug)
    : null;

  // Pre-load Yonah's saved default quality tier so the generate dialog opens
  // with his preference selected (he can change per-run or save a new one).
  const supabaseForSettings = await createClient();
  const { data: defaultTierRow } = await supabaseForSettings
    .from('site_content')
    .select('value')
    .eq('key', 'settings.default_tier')
    .maybeSingle();
  const defaultTierKey: string = defaultTierRow?.value ?? '720p standard';

  const parsha = hebcalParsha
    ? ((await getParshaBySlug(hebcalParsha.slug)) ?? fallbackParsha)
    : fallbackParsha;

  const hebcalHebrew = hebcalParsha?.hebrew ?? null;

  const aTightScript = parsha?.scripts?.find((s) => s.option === 'A-tight') ?? parsha?.scripts?.[0] ?? null;

  // In a combined-parsha week, both parshiot get tagged on the resulting
  // job so /parshiot's 54-grid shows the same thumbnail on BOTH rows.
  // Undefined when there's just the host parsha (regular weeks).
  const combinedParshaIds = parsha && partnerParsha
    ? [parsha.id, partnerParsha.id]
    : parsha
      ? [parsha.id]
      : undefined;

  // Real production-arc state: query the latest job + posts for THIS parsha
  // so the dots reflect actual state (was hardcoded 'awaiting your go' even
  // when the video was already done). Suspense-friendly: if these fail or
  // are slow, the page still renders.
  const arc = await computeProductionArc(parsha?.id);

  // Posting-pivot data: when this week's parsha has a done video, swap the
  // script carousel for a posting-focused panel. We fetch latest done job +
  // its captions + posts, then pass it all into <TodayPostingPanel>.
  const posting = parsha?.id ? await loadPostingData(parsha.id) : null;
  const bufferConfigured = !!process.env.BUFFER_ACCESS_TOKEN;

  return (
    <>
      <div className="stagger">
        {/* Stance line — client component with toggle sheet */}
        <StanceToggle initialStance={stance} />

        {/* System health — quiet status strip; suspended so page paints fast */}
        <Suspense fallback={<SystemHealthSkeleton />}>
          <SystemHealthAsync />
        </Suspense>

        {/* Upcoming holiday card — shown only when a holiday with a matching
            parshiot row falls within 21 days. */}
        {upcomingHoliday && (
          <Link
            href={`/videos/${upcomingHoliday.slug}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '14px 20px',
              marginBottom: '24px',
              border: '1px dashed var(--cedar-300)',
              borderRadius: 'var(--r-lg)',
              background: 'linear-gradient(180deg, rgba(168,114,47,.05) 0%, var(--linen-50) 80%)',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'all var(--trans)',
              minHeight: '44px',
            }}
            className="cal-week"
          >
            <div
              aria-hidden="true"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'var(--cedar-100)',
                display: 'grid',
                placeItems: 'center',
                fontSize: '15px',
                flexShrink: 0,
              }}
            >
              ✨
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontSize: '11px',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: 'var(--cedar-700)',
                  marginBottom: '2px',
                }}
              >
                Coming up
              </div>
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontWeight: 500,
                  fontSize: '17px',
                  color: 'var(--ink-900)',
                  letterSpacing: '-0.01em',
                  fontVariationSettings: '"opsz" 24, "SOFT" 30',
                }}
              >
                {upcomingHoliday.name}
                <span
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontStyle: 'italic',
                    fontWeight: 400,
                    fontSize: '14px',
                    color: 'var(--ink-500)',
                    marginLeft: '10px',
                  }}
                >
                  {upcomingHoliday.days <= 0 ? 'today' : upcomingHoliday.days === 1 ? 'tomorrow' : `in ${upcomingHoliday.days} days`}
                </span>
              </div>
            </div>
            <div
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '13px',
                color: 'var(--cedar-700)',
                whiteSpace: 'nowrap',
                fontVariationSettings: '"opsz" 14, "SOFT" 50',
              }}
            >
              Open →
            </div>
          </Link>
        )}

        {/* REVIEWER VIEW */}
        <div>

          {/* SAGE PAGE — the hero */}
          <article
            style={{
              position: 'relative',
              padding: '60px 70px 56px',
              background: 'var(--linen-50)',
              border: '1px solid var(--ink-100)',
              borderRadius: 'var(--r-xl)',
              boxShadow: 'var(--shadow-page)',
              marginBottom: '48px',
              overflow: 'hidden',
            }}
            className="sage-page"
          >
            {/* warm rice-paper wash */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                backgroundImage: 'radial-gradient(800px 400px at 95% -10%, rgba(200,146,86,.14), transparent 55%), repeating-linear-gradient(91deg, transparent 0 3px, rgba(106,70,34,.010) 3px 4px)',
              }}
            />

            {/* Page header */}
            <header
              style={{
                position: 'relative',
                marginBottom: '44px',
                paddingBottom: '28px',
                borderBottom: '1px solid var(--ink-100)',
              }}
            >
              <div
                  lang="he"
                  dir="rtl"
                  style={{
                    fontFamily: 'var(--ff-hebrew)',
                    fontSize: 'clamp(30px, 4vw, 46px)',
                    fontWeight: 400,
                    color: 'var(--ink-700)',
                    lineHeight: 1,
                    marginBottom: '20px',
                    textAlign: 'right',
                    direction: 'rtl',
                  }}
                >
                  {hebcalHebrew ? `פרשת ${hebcalHebrew}` : `פרשת ${parsha?.name ?? 'השבוע'}`}
                </div>

              <div
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontSize: '10.5px',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--cedar-600)',
                  marginBottom: '10px',
                  textAlign: 'left',
                }}
              >
                This week · {parsha?.book ?? 'Vayikra'}
              </div>

              <h1
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontWeight: 400,
                  fontSize: 'clamp(40px, 7vw, 92px)',
                  lineHeight: 0.96,
                  letterSpacing: '-0.035em',
                  color: 'var(--ink-900)',
                  margin: 0,
                  textAlign: 'left',
                  fontVariationSettings: '"opsz" 144, "SOFT" 20',
                }}
              >
                {parsha?.name ?? 'Kedoshim'}
                <em style={{ fontStyle: 'italic', color: 'var(--cedar-600)', fontVariationSettings: '"opsz" 144, "SOFT" 70' }}>.</em>
              </h1>
              {hebcalParsha?.combined && (
                <div
                  style={{
                    marginTop: '8px',
                    fontFamily: 'var(--ff-display)',
                    fontStyle: 'italic',
                    fontSize: '15px',
                    color: 'var(--cedar-600)',
                    fontVariationSettings: '"opsz" 18, "SOFT" 60',
                  }}
                >
                  paired with {hebcalParsha.combined} this Shabbat
                </div>
              )}

              <div
                style={{
                  marginTop: '14px',
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '14px',
                  color: 'var(--ink-500)',
                  textAlign: 'left',
                  fontVariationSettings: '"opsz" 16, "SOFT" 50',
                }}
              >
                {hebcalParsha?.shabbatDate
                  ? `Shabbat ${new Date(hebcalParsha.shabbatDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · script A-tight`
                  : 'Shabbat · script A-tight'
                }{aTightScript?.draft_text ? `, ${aTightScript.draft_text.trim().split(/\s+/).length} words` : ''}
              </div>
            </header>

            {/* Script carousel — flip between variants or generate a new one from an idea */}
            {parsha && parsha.scripts && parsha.scripts.length > 0 ? (
              <div style={{ position: 'relative', maxWidth: '62ch', margin: '0 auto' }}>
                {posting ? (
                  <TodayPostingPanel
                    parshaSlug={parsha.slug}
                    parshaName={parsha.name}
                    jobId={posting.jobId}
                    videoId={posting.videoId}
                    videoUrl={posting.videoUrl}
                    thumbUrl={posting.thumbUrl}
                    videoCostUsd={posting.videoCostUsd}
                    chosenScriptOption={posting.chosenScriptOption}
                    publishedToSite={posting.publishedToSite}
                    captions={posting.captions}
                    postsByPlatform={posting.postsByPlatform}
                    bufferConfigured={bufferConfigured}
                    carousel={
                      <ScriptCarousel
                        parshaId={parsha.id}
                        parshaName={parsha.name}
                        parshaSlug={parsha.slug}
                        defaultTierKey={defaultTierKey}
                        combinedParshaIds={combinedParshaIds}
                        scripts={
                          partnerParsha
                            ? [
                                ...(parsha.scripts as CarouselScript[]),
                                ...((partnerParsha.scripts ?? []) as CarouselScript[]).map((s) => ({
                                  ...s,
                                  parsha_id: partnerParsha.id,
                                  parsha_name: partnerParsha.name,
                                  parsha_slug: partnerParsha.slug,
                                })),
                              ]
                            : (parsha.scripts as CarouselScript[])
                        }
                      />
                    }
                  />
                ) : (
                  <ScriptCarousel
                    parshaId={parsha.id}
                    parshaName={parsha.name}
                    parshaSlug={parsha.slug}
                    defaultTierKey={defaultTierKey}
                    combinedParshaIds={combinedParshaIds}
                    scripts={
                      // Merge partner parsha's scripts after the host's, each
                      // tagged so ScriptCard knows where it came from.
                      partnerParsha
                        ? [
                            ...(parsha.scripts as CarouselScript[]),
                            ...((partnerParsha.scripts ?? []) as CarouselScript[]).map((s) => ({
                              ...s,
                              parsha_id: partnerParsha.id,
                              parsha_name: partnerParsha.name,
                              parsha_slug: partnerParsha.slug,
                            })),
                          ]
                        : (parsha.scripts as CarouselScript[])
                    }
                  />
                )}
              </div>
            ) : (
              /* Fallback: no parsha in DB yet — show a teaser preview */
              <div
                style={{
                  position: 'relative',
                  maxWidth: '62ch',
                  margin: '0 auto',
                  fontFamily: 'var(--ff-reading)',
                  fontSize: '19px',
                  lineHeight: 1.68,
                  color: 'var(--ink-800)',
                  fontVariationSettings: '"opsz" 18, "SOFT" 30',
                }}
              >
                <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--ink-500)' }}>
                  No scripts for this parsha yet.
                </p>
              </div>
            )}

          </article>

          {/* PRODUCTION ARC */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '18px',
              padding: '22px 28px',
              border: '1px solid var(--ink-100)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--linen-50)',
              marginBottom: '40px',
              fontFamily: 'var(--ff-display)',
              fontSize: '14.5px',
              fontStyle: 'italic',
              color: 'var(--ink-500)',
              fontVariationSettings: '"opsz" 14, "SOFT" 40',
              flexWrap: 'wrap',
            }}
          >
            <ArcStage done={arc.script === 'done'} running={arc.script === 'running'} label="Script" />
            <ArcSep />
            <ArcStage done={arc.video === 'done'} running={arc.video === 'running'} label={arc.videoLabel} />
            <ArcSep />
            <ArcStage done={arc.captions === 'done'} running={arc.captions === 'running'} label="Captions" />
            <ArcSep />
            <ArcStage done={arc.schedule === 'done'} running={arc.schedule === 'running'} label={arc.scheduleLabel} />
          </div>

          {/* Whisper lines (last-week perf, ad-hoc drafts) removed —
              they were design-mock copy ('Shemot is out in the world.
              3,412 have seen it…') that read as fake to a real user.
              Real analytics + drafts surfaces will replace them when
              the Buffer + Compose data wires through. */}

        </div>
      </div>

      {/* FAB — floating action button */}
      <Fab />
    </>
  );
}

// Helper sub-components

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
    <span
      style={{
        fontFamily: 'var(--ff-display)',
        color: 'var(--ink-200)',
        fontStyle: 'normal',
        fontSize: '13px',
      }}
    >
      —
    </span>
  );
}
