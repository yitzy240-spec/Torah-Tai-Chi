import { createClient } from '@/lib/supabase/server';
import { StanceToggle } from '@/components/stance-toggle';
import { Fab } from '@/components/fab';

// Types
interface Script {
  id: string;
  option: string;
  title: string | null;
  body: string | null;
  word_count: number | null;
}

interface Parsha {
  id: string;
  order: number;
  name: string;
  name_hebrew: string | null;
  book: string;
  slug: string;
  scripts: Script[];
}

async function getNextParsha(): Promise<Parsha | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('parshiot')
    .select('id, order, name, name_hebrew, book, slug, scripts(id, option, title, body, word_count)')
    .order('order')
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as Parsha;
}

export default async function TodayPage() {
  const parsha = await getNextParsha();

  // Get the A-tight script if available
  const aTightScript = parsha?.scripts?.find((s) => s.option === 'a-tight' || s.option === 'a_tight') ?? parsha?.scripts?.[0] ?? null;

  return (
    <>
      <div className="stagger">
        {/* Stance line — client component with toggle sheet */}
        <StanceToggle initialStance="reviewer" />

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
              {parsha?.name_hebrew ? (
                <div
                  lang="he"
                  dir="rtl"
                  style={{
                    fontFamily: 'var(--ff-hebrew)',
                    fontSize: 'clamp(30px, 4vw, 46px)',
                    fontWeight: 400,
                    color: 'var(--ink-700)',
                    letterSpacing: 0,
                    lineHeight: 1,
                    marginBottom: '20px',
                    textAlign: 'right',
                    direction: 'rtl',
                  }}
                >
                  {parsha.name_hebrew}
                </div>
              ) : (
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
                  פרשת קדושים
                </div>
              )}

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
                This week · {parsha?.book ?? 'Leviticus'} · order {parsha?.order ?? 30}
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
                Shabbat April 25 · script A-tight
                {aTightScript?.word_count ? `, ${aTightScript.word_count} words` : ', 108 words'}
              </div>
            </header>

            {/* Script body */}
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
              {aTightScript?.body ? (
                <div>
                  <p style={{ margin: '0 0 22px 0' }}>{aTightScript.body}</p>
                </div>
              ) : (
                <>
                  <p
                    style={{
                      fontStyle: 'italic',
                      fontSize: '22px',
                      lineHeight: 1.5,
                      color: 'var(--ink-900)',
                      marginBottom: '28px',
                      fontVariationSettings: '"opsz" 36, "SOFT" 40',
                      margin: '0 0 28px 0',
                    }}
                  >
                    Everyone quotes <em>love your neighbor as yourself</em> — but nobody reads the verse before it.
                  </p>

                  <p style={{ margin: '0 0 22px 0' }}>
                    Parshat Kedoshim begins with{' '}
                    <span lang="he" dir="rtl" style={{ fontFamily: 'var(--ff-hebrew)', fontStyle: 'normal', color: 'var(--ink-700)' }}>
                      קדושים תהיו
                    </span>
                    {' '}— <em>Kedoshim tihiyu, be holy.</em> Then dozens of commands: don&apos;t gossip, don&apos;t hold grudges, pay workers on time. Kedusha isn&apos;t a feeling. It&apos;s restraint — what you don&apos;t do when your ego wants to strike.
                  </p>

                  <p style={{ margin: '0 0 22px 0' }}>
                    In tai chi this is{' '}
                    <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', color: 'var(--cedar-600)', fontVariationSettings: '"opsz" 14, "SOFT" 80' }}>
                      song 松
                    </span>
                    {' '}— not collapse, not force. Stand in{' '}
                    <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', color: 'var(--cedar-600)', fontVariationSettings: '"opsz" 14, "SOFT" 80' }}>
                      zhan zhuang
                    </span>{' '}
                    and someone pushes your chest. You don&apos;t brace, don&apos;t crumble. You soften into your root and the pressure passes through.
                  </p>

                  <p style={{ margin: '0 0 22px 0' }}>
                    That&apos;s kedusha. The discipline of non-reactivity that makes <em>love your neighbor</em> even possible.
                  </p>

                  <p style={{ margin: '0 0 22px 0' }}>
                    One breath before you respond. That breath is the practice.
                  </p>

                  <div
                    style={{
                      marginTop: '28px',
                      textAlign: 'center',
                      fontFamily: 'var(--ff-display)',
                      fontStyle: 'italic',
                      fontSize: '12px',
                      color: 'var(--ink-400)',
                      letterSpacing: '0.18em',
                    }}
                  >
                    · · ·
                  </div>
                </>
              )}
            </div>

            {/* Page footer actions */}
            <footer
              style={{
                marginTop: '52px',
                paddingTop: '28px',
                borderTop: '1px solid var(--ink-100)',
                display: 'flex',
                alignItems: 'center',
                gap: '18px',
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '14px',
                  color: 'var(--ink-500)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 30',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: 'var(--cedar-500)',
                    marginRight: '8px',
                    transform: 'translateY(-2px)',
                  }}
                />
                Ready for your eye.
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={{
                    fontFamily: 'var(--ff-body)',
                    fontSize: '13px',
                    color: 'var(--ink-500)',
                    background: 'none',
                    border: 'none',
                    padding: '11px 4px',
                    minHeight: '44px',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textDecorationColor: 'var(--ink-200)',
                    textUnderlineOffset: '4px',
                    transition: 'all var(--trans)',
                  }}
                >
                  Adjust the script
                </button>
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
                  Regenerate
                </button>
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
                    border: '1px solid var(--navy-800)',
                    background: 'var(--navy-800)',
                    color: 'var(--linen-50)',
                    cursor: 'pointer',
                    transition: 'all var(--trans)',
                    boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)',
                  }}
                >
                  Approve · generate video
                </button>
              </div>
            </footer>
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
