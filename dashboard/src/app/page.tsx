import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { StanceToggle } from '@/components/stance-toggle';
import { Fab } from '@/components/fab';
import { getThisWeekParsha } from '@/lib/hebcal';
import { GenerateDialog } from '@/components/generate-dialog';
import { checkHealth } from '@/lib/health';
import { SystemHealthStrip } from '@/components/system-health';
import { ScriptCarousel, type CarouselScript } from '@/components/script-carousel';
import { getStance } from '@/lib/stance';

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
  draft_text: string | null;
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
    .select('id, order, name, book, slug, scripts(id, option, title, draft_text, motion_ref_slug)')
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

  // Captions presence — pulled from the latest clip_plan
  let captionsPresent = false;
  if (latestJob?.id) {
    const { data: planRow } = await supabase
      .from('clip_plans')
      .select('plan_json')
      .eq('job_id', latestJob.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const planJson = (planRow?.plan_json ?? {}) as { captions?: Record<string, string> };
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

async function getParshaBySlug(slug: string): Promise<Parsha | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('parshiot')
    .select('id, order, name, book, slug, scripts(id, option, title, draft_text, motion_ref_slug)')
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
  const [hebcalParsha, fallbackParsha, stance] = await Promise.all([
    getThisWeekParsha(),
    getNextParsha(),
    getStance(),
  ]);

  const parsha = hebcalParsha
    ? ((await getParshaBySlug(hebcalParsha.slug)) ?? fallbackParsha)
    : fallbackParsha;

  const hebcalHebrew = hebcalParsha?.hebrew ?? null;

  const aTightScript = parsha?.scripts?.find((s) => s.option === 'A-tight') ?? parsha?.scripts?.[0] ?? null;

  // Real production-arc state: query the latest job + posts for THIS parsha
  // so the dots reflect actual state (was hardcoded 'awaiting your go' even
  // when the video was already done). Suspense-friendly: if these fail or
  // are slow, the page still renders.
  const arc = await computeProductionArc(parsha?.id);

  return (
    <>
      <div className="stagger">
        {/* Stance line — client component with toggle sheet */}
        <StanceToggle initialStance={stance} />

        {/* System health — quiet status strip; suspended so page paints fast */}
        <Suspense fallback={<SystemHealthSkeleton />}>
          <SystemHealthAsync />
        </Suspense>

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
                <ScriptCarousel
                  parshaId={parsha.id}
                  parshaName={parsha.name}
                  parshaSlug={parsha.slug}
                  scripts={parsha.scripts as CarouselScript[]}
                />
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
