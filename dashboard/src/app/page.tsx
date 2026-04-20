import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { StanceToggle } from '@/components/stance-toggle';
import { Fab } from '@/components/fab';
import { getThisWeekParsha } from '@/lib/hebcal';
import { GenerateDialog } from '@/components/generate-dialog';
import { checkHealth } from '@/lib/health';
import { SystemHealthStrip } from '@/components/system-health';
import { ScriptCarousel, type CarouselScript } from '@/components/script-carousel';

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
    .select('id, order, name, book, slug, scripts(id, option, title, draft_text)')
    .order('order')
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as Parsha;
}

async function getParshaBySlug(slug: string): Promise<Parsha | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('parshiot')
    .select('id, order, name, book, slug, scripts(id, option, title, draft_text)')
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
  const [hebcalParsha, fallbackParsha] = await Promise.all([
    getThisWeekParsha(),
    getNextParsha(),
  ]);

  const parsha = hebcalParsha
    ? ((await getParshaBySlug(hebcalParsha.slug)) ?? fallbackParsha)
    : fallbackParsha;

  const hebcalHebrew = hebcalParsha?.hebrew ?? null;

  const aTightScript = parsha?.scripts?.find((s) => s.option === 'A-tight') ?? parsha?.scripts?.[0] ?? null;

  return (
    <>
      <div className="stagger">
        {/* Stance line — client component with toggle sheet */}
        <StanceToggle initialStance="reviewer" />

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
                This week · {parsha?.book ?? 'Vayikra'} · order {parsha?.order ?? 30}
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
            <ArcStage done label="Script · approved Tue" />
            <ArcSep />
            <ArcStage running label="Video · awaiting your go" />
            <ArcSep />
            <ArcStage label="Captions" />
            <ArcSep />
            <ArcStage label="Schedule" />
            <a
              href="#"
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '12px',
                fontStyle: 'normal',
                color: 'var(--ink-400)',
                marginLeft: 'auto',
                textDecoration: 'none',
                letterSpacing: '0.02em',
              }}
            >
              See under the hood →
            </a>
          </div>

          {/* WHISPER LINE — last week performance */}
          <p
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '15px',
              color: 'var(--ink-500)',
              marginBottom: '40px',
              lineHeight: 1.55,
              fontVariationSettings: '"opsz" 18, "SOFT" 50',
            }}
          >
            <strong
              style={{
                fontWeight: 500,
                fontStyle: 'normal',
                color: 'var(--ink-900)',
                fontVariationSettings: '"opsz" 18, "SOFT" 20',
              }}
            >
              Shemot
            </strong>{' '}
            is out in the world. 3,412 have seen it; 3 questions await your eye on TikTok.
            <a
              href="#"
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '12px',
                fontStyle: 'normal',
                color: 'var(--ink-400)',
                textDecoration: 'none',
                letterSpacing: '0.03em',
                marginLeft: '10px',
                paddingLeft: '12px',
                borderLeft: '1px solid var(--ink-200)',
              }}
            >
              Open Shemot →
            </a>
          </p>

          {/* WHISPER LINE — quiet variant */}
          <p
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '14px',
              color: 'var(--ink-400)',
              marginBottom: '40px',
              lineHeight: 1.55,
              fontVariationSettings: '"opsz" 16, "SOFT" 50',
            }}
          >
            You also have{' '}
            <strong
              style={{
                fontWeight: 500,
                fontStyle: 'normal',
                color: 'var(--ink-700)',
                fontVariationSettings: '"opsz" 16, "SOFT" 20',
              }}
            >
              1 ad-hoc draft
            </strong>{' '}
            from yesterday awaiting your eye.
            <a
              href="#"
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '12px',
                fontStyle: 'normal',
                color: 'var(--ink-400)',
                textDecoration: 'none',
                letterSpacing: '0.03em',
                marginLeft: '10px',
                paddingLeft: '12px',
                borderLeft: '1px solid var(--ink-200)',
              }}
            >
              Review it →
            </a>
          </p>

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
