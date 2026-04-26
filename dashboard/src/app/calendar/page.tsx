import Link from 'next/link';
import { getUpcomingWeeks, getUpcomingHolidays, ShabbatParsha, UpcomingHoliday } from '@/lib/hebcal';
import { createClient } from '@/lib/supabase/server';

// Hardcoded production status per parsha slug (wired to real Supabase later).
const HARDCODED_STATUS: Record<string, { status: string; dotColor: string; dotClass: string }> = {
  'kedoshim':    { status: 'Video approved, ships Friday', dotColor: 'var(--jade)',      dotClass: 'jade' },
  'emor':        { status: 'Script ready, video pending',  dotColor: 'var(--cedar-500)', dotClass: 'cedar' },
  'behar':       { status: 'Needs review',                 dotColor: 'var(--cedar-500)', dotClass: 'cedar' },
  'bechukotai':  { status: 'Generating...',                dotColor: 'var(--navy-700)',  dotClass: 'navy' },
  'bamidbar':    { status: 'Not started',                  dotColor: 'var(--ink-300)',   dotClass: 'gray' },
  'naso':        { status: 'Not started',                  dotColor: 'var(--ink-300)',   dotClass: 'gray' },
};

const DEFAULT_STATUS = { status: 'Not started', dotColor: 'var(--ink-300)', dotClass: 'gray' };

function formatWhen(shabbatDate: string, index: number): { dateLabel: string; when: string } {
  const d = new Date(shabbatDate + 'T12:00:00');
  const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const when =
    index === 0 ? 'This Friday' :
    index === 1 ? 'Next week' :
    `In ${index + 1} weeks`;
  return { dateLabel, when };
}

type CalendarRow =
  | { kind: 'parsha'; date: string; data: ShabbatParsha; weekIndex: number }
  | { kind: 'holiday'; date: string; data: UpcomingHoliday; hasRow: boolean };

export default async function CalendarPage() {
  // Feature A: live Hebcal data
  const weeks = await getUpcomingWeeks(6);
  const holidays = await getUpcomingHolidays(180);

  // Cap holidays to those falling before our last upcoming Shabbat row,
  // otherwise the rolling 6-week view would balloon to half the year.
  const lastWeek = weeks[weeks.length - 1]?.shabbatDate;
  const visibleHolidays = lastWeek
    ? holidays.filter((h) => h.date <= lastWeek)
    : holidays;

  // Look up which holidays already have a parshiot row (so we know they're
  // generatable). Slugs not in the DB still show but go to the calendar
  // hint only.
  const supabase = await createClient();
  const slugs = visibleHolidays.map((h) => h.slug);
  const generatable = new Set<string>();
  if (slugs.length > 0) {
    const { data } = await supabase.from('parshiot').select('slug').in('slug', slugs);
    for (const r of data ?? []) generatable.add(r.slug);
  }

  const rows: CalendarRow[] = [
    ...weeks.map<CalendarRow>((w, i) => ({
      kind: 'parsha', date: w.shabbatDate, data: w, weekIndex: i,
    })),
    ...visibleHolidays.map<CalendarRow>((h) => ({
      kind: 'holiday', date: h.date, data: h, hasRow: generatable.has(h.slug),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="stagger">
      {/* Page header */}
      <div>
        <h1
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(36px, 5vw, 56px)',
            lineHeight: 1.02,
            letterSpacing: '-0.025em',
            margin: '0 0 8px 0',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 110, "SOFT" 30',
          }}
        >
          Six weeks <em style={{ fontStyle: 'italic', color: 'var(--ink-500)', fontVariationSettings: '"opsz" 110, "SOFT" 60' }}>ahead.</em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '16px',
            color: 'var(--ink-500)',
            margin: '0 0 44px 0',
            fontVariationSettings: '"opsz" 16, "SOFT" 50',
          }}
        >
          Your rolling view of what&apos;s coming, what&apos;s ready, and what needs your eye.
        </p>
      </div>

      {/* Calendar rows — live from Hebcal */}
      {rows.length === 0 ? (
        <CalendarFallback />
      ) : (
        <CalendarRows rows={rows} />
      )}
    </div>
  );
}

function HolidayRow({ row }: { row: Extract<CalendarRow, { kind: 'holiday' }> }) {
  const { data, hasRow } = row;
  const d = new Date(data.date + 'T12:00:00');
  const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((d.getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000);
  const when = days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;

  const Inner = (
    <>
      <div style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--ink-500)' }}>
        <strong style={{ fontWeight: 500, color: 'var(--cedar-700)', display: 'block', fontSize: '14px' }}>
          {dateLabel}
        </strong>
        {when}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: '20px',
            color: 'var(--ink-900)',
            letterSpacing: '-0.015em',
            fontVariationSettings: '"opsz" 36, "SOFT" 30',
          }}
        >
          {data.name}
        </span>
        <span
          lang="he"
          dir="rtl"
          style={{ fontFamily: 'var(--ff-hebrew)', fontSize: '16px', color: 'var(--ink-500)' }}
        >
          {data.hebrew}
        </span>
        <span
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '10.5px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--cedar-700)',
            background: 'var(--cedar-100)',
            padding: '3px 10px',
            borderRadius: '999px',
          }}
        >
          Holiday
        </span>
      </div>
      <div
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '13.5px',
          color: hasRow ? 'var(--cedar-700)' : 'var(--ink-400)',
          textAlign: 'right',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
          whiteSpace: 'nowrap',
        }}
      >
        {hasRow ? 'Open →' : 'Coming soon'}
      </div>
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '120px 1fr auto',
    gap: '20px',
    alignItems: 'center',
    padding: '20px 24px',
    border: '1px dashed var(--cedar-300)',
    borderRadius: 'var(--r-lg)',
    background: 'linear-gradient(180deg, rgba(168,114,47,.04) 0%, var(--linen-50) 80%)',
    marginBottom: '10px',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'all var(--trans)',
    minHeight: '44px',
  };

  return hasRow ? (
    <Link href={`/videos/${data.slug}`} style={{ ...baseStyle, cursor: 'pointer' }} className="cal-week">
      {Inner}
    </Link>
  ) : (
    <div style={baseStyle}>{Inner}</div>
  );
}

function CalendarRows({ rows }: { rows: CalendarRow[] }) {
  let weekCounter = 0;
  return (
    <div>
      {rows.map((row) => {
        if (row.kind === 'holiday') {
          return <HolidayRow key={`h-${row.data.slug}-${row.date}`} row={row} />;
        }
        const week = row.data;
        const i = weekCounter++;
        const { dateLabel, when } = formatWhen(week.shabbatDate, i);
        const isCurrent = i === 0;
        const statusCfg = HARDCODED_STATUS[week.slug] ?? DEFAULT_STATUS;

        return (
          <div key={`p-${week.slug}`}>
            {/* Holiday banner: show if this week has a holiday */}
            {week.holiday && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 24px',
                  marginBottom: '10px',
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '13px',
                  color: 'var(--cedar-600)',
                  fontVariationSettings: '"opsz" 14, "SOFT" 60',
                }}
              >
                <div
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: 'var(--cedar-100)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '10px',
                    flexShrink: 0,
                  }}
                >
                  ✨
                </div>
                {week.holiday} · {dateLabel}
              </div>
            )}

            <Link
              href={`/videos/${week.slug}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr auto',
                gap: '20px',
                alignItems: 'center',
                padding: '20px 24px',
                border: `1px solid ${isCurrent ? 'var(--cedar-300)' : 'var(--ink-100)'}`,
                borderRadius: 'var(--r-lg)',
                background: isCurrent
                  ? 'linear-gradient(180deg, var(--linen-100) 0%, var(--linen-50) 80%)'
                  : 'var(--linen-50)',
                marginBottom: '10px',
                cursor: 'pointer',
                textDecoration: 'none',
                color: 'inherit',
                transition: 'all var(--trans)',
                minHeight: '44px',
                position: 'relative',
              }}
              className={`cal-week${isCurrent ? ' cal-week-current' : ''}`}
            >
              {/* Current week top bar accent */}
              {isCurrent && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '3px',
                    background: 'linear-gradient(90deg, var(--cedar-500), var(--cedar-600))',
                    borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
                  }}
                />
              )}

              {/* Date column */}
              <div
                style={{
                  fontFamily: 'var(--ff-body)',
                  fontSize: '13px',
                  color: 'var(--ink-500)',
                }}
              >
                <strong style={{ fontWeight: 500, color: 'var(--ink-900)', display: 'block', fontSize: '14px' }}>
                  {dateLabel}
                </strong>
                {when}
              </div>

              {/* Parsha name */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontFamily: 'var(--ff-display)',
                    fontWeight: 500,
                    fontSize: '20px',
                    color: 'var(--ink-900)',
                    letterSpacing: '-0.015em',
                    fontVariationSettings: '"opsz" 36, "SOFT" 30',
                  }}
                >
                  {week.name}
                  {week.combined && (
                    <span style={{ color: 'var(--ink-400)', fontWeight: 400, fontSize: '16px', marginLeft: '6px' }}>
                      +{week.combined}
                    </span>
                  )}
                </span>
                <span
                  lang="he"
                  dir="rtl"
                  style={{
                    fontFamily: 'var(--ff-hebrew)',
                    fontSize: '16px',
                    color: 'var(--ink-500)',
                  }}
                >
                  {week.hebrew}
                </span>
              </div>

              {/* Status */}
              <div
                style={{
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: '13.5px',
                  color: 'var(--ink-500)',
                  textAlign: 'right',
                  fontVariationSettings: '"opsz" 14, "SOFT" 50',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    marginRight: '8px',
                    transform: 'translateY(-1px)',
                    background: statusCfg.dotColor,
                    animation: statusCfg.dotClass === 'navy' ? 'pulse-navy 1.8s ease-in-out infinite' : undefined,
                  }}
                />
                {statusCfg.status}
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}

// Shown only if Hebcal API fails completely
function CalendarFallback() {
  return (
    <div
      style={{
        padding: '40px',
        textAlign: 'center',
        fontFamily: 'var(--ff-display)',
        fontStyle: 'italic',
        fontSize: '16px',
        color: 'var(--ink-400)',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
      }}
    >
      Calendar unavailable — could not reach Hebcal. Check back shortly.
    </div>
  );
}
