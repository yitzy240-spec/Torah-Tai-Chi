'use client';
// start-next-video-picker.tsx
//
// Client component housing the "Start working on next video" 4-card panel
// plus the two bottom sheets (parsha picker, topic video).
//
// Receives pre-computed server data as props; all I/O is via server actions.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startFromEmpty } from '@/app/actions/video-page/start-from-empty';
import { startTopicVideo } from '@/app/actions/video-page/start-topic-video';

// ─── Types ─────────────────────────────────────────────────────────────────

type ParshaOption = {
  id: string;
  slug: string;
  name: string;
  book: string;
  order: number;
};

type UpcomingParshaProps = {
  id: string;
  slug: string;
  name: string;
  book: string;
  shabbatDate: string | null;
  hebrew: string | null;
  /** true when this IS the upcoming Shabbat; false = next available weekly parsha (fallback) */
  isThisShabbat: boolean;
};

type UpcomingHolidayProps = {
  id: string;
  slug: string;
  name: string;
  days: number;
} | null;

type Props = {
  upcomingParsha: UpcomingParshaProps | null;
  upcomingHoliday: UpcomingHolidayProps;
  allParshiot: ParshaOption[];
  v2Suffix: string; // "?v2=1" when the flag gate is via query param
};

// ─── Styles ────────────────────────────────────────────────────────────────

const cardBase: React.CSSProperties = {
  position: 'relative',
  padding: '22px 24px',
  border: '1.5px solid var(--ink-100)',
  borderRadius: 'var(--r-lg)',
  background: 'var(--linen-50)',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  cursor: 'pointer',
  transition: 'all var(--trans)',
  minHeight: '44px',
  textAlign: 'left',
};

const cardLabel: React.CSSProperties = {
  fontFamily: 'var(--ff-body)',
  fontSize: '10.5px',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--cedar-600)',
};

const cardTitle: React.CSSProperties = {
  fontFamily: 'var(--ff-display)',
  fontWeight: 500,
  fontSize: '20px',
  color: 'var(--ink-900)',
  letterSpacing: '-0.02em',
  fontVariationSettings: '"opsz" 24, "SOFT" 30',
  lineHeight: 1.15,
};

const cardSub: React.CSSProperties = {
  fontFamily: 'var(--ff-display)',
  fontStyle: 'italic',
  fontSize: '13px',
  color: 'var(--ink-500)',
  fontVariationSettings: '"opsz" 14, "SOFT" 50',
};

const ctaBtn: React.CSSProperties = {
  marginTop: '6px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontFamily: 'var(--ff-body)',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--navy-700)',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  letterSpacing: '0.01em',
  minHeight: '44px',
};

// ─── Overlay sheet ─────────────────────────────────────────────────────────

function Sheet({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(35,27,16,.35)',
          zIndex: 40,
          backdropFilter: 'blur(2px)',
        }}
      />
      {/* Sheet panel */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: 'var(--linen-50)',
          borderTop: '1.5px solid var(--ink-100)',
          borderRadius: '20px 20px 0 0',
          padding: '24px 20px calc(24px + env(safe-area-inset-bottom))',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 -8px 40px rgba(35,27,16,.14)',
        }}
      >
        {/* Drag handle */}
        <div
          aria-hidden="true"
          style={{
            width: '36px',
            height: '4px',
            borderRadius: '2px',
            background: 'var(--ink-200)',
            margin: '0 auto 20px',
          }}
        />
        {children}
      </div>
    </>
  );
}

// ─── Parsha picker sheet ───────────────────────────────────────────────────

function ParshaPickerSheet({
  open,
  onClose,
  allParshiot,
  v2Suffix,
}: {
  open: boolean;
  onClose: () => void;
  allParshiot: ParshaOption[];
  v2Suffix: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeParshaId, setActiveParshaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(parsha: ParshaOption) {
    setActiveParshaId(parsha.id);
    setError(null);
    startTransition(async () => {
      const res = await startFromEmpty(parsha.id, parsha.slug);
      if (!res.ok) {
        setError(res.error);
        setActiveParshaId(null);
        return;
      }
      router.push(`/videos/${parsha.slug}${v2Suffix}`);
    });
  }

  const bookOrder = ['Bereishit', 'Shemot', 'Vayikra', 'Bamidbar', 'Devarim'];
  const grouped: Record<string, ParshaOption[]> = {};
  for (const p of allParshiot) {
    const book = p.book;
    if (!grouped[book]) grouped[book] = [];
    grouped[book].push(p);
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <h2
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 500,
          fontSize: '22px',
          color: 'var(--ink-900)',
          letterSpacing: '-0.02em',
          margin: '0 0 20px',
          fontVariationSettings: '"opsz" 28, "SOFT" 20',
        }}
      >
        Pick a parsha
      </h2>

      {error && (
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--tassel)',
            marginBottom: '12px',
          }}
        >
          {error}
        </div>
      )}

      {bookOrder.map((book) => {
        const parshiot = grouped[book];
        if (!parshiot || parshiot.length === 0) return null;
        return (
          <div key={book} style={{ marginBottom: '20px' }}>
            <div
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '10.5px',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--cedar-600)',
                marginBottom: '8px',
              }}
            >
              {book}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {parshiot.map((p) => {
                const isActive = activeParshaId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => handlePick(p)}
                    disabled={isPending}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '11px 14px',
                      borderRadius: 'var(--r-md)',
                      border: '1px solid transparent',
                      background: isActive ? 'var(--navy-wash)' : 'transparent',
                      fontFamily: 'var(--ff-body)',
                      fontSize: '15px',
                      color: isActive ? 'var(--navy-700)' : 'var(--ink-900)',
                      fontWeight: isActive ? 600 : 400,
                      cursor: isPending ? 'wait' : 'pointer',
                      minHeight: '44px',
                      textAlign: 'left',
                      transition: 'all var(--trans)',
                    }}
                  >
                    <span>{p.name}</span>
                    {isActive && (
                      <span
                        style={{
                          fontFamily: 'var(--ff-display)',
                          fontStyle: 'italic',
                          fontSize: '12px',
                          color: 'var(--navy-700)',
                        }}
                      >
                        Starting…
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}

// ─── Topic video sheet ─────────────────────────────────────────────────────

function TopicVideoSheet({
  open,
  onClose,
  v2Suffix,
}: {
  open: boolean;
  onClose: () => void;
  v2Suffix: string;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setError(null);
    startTransition(async () => {
      const res = await startTopicVideo({ topic: topic.trim() || undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Topic videos don't have a parsha slug yet. For now land on root
      // so Yonah can see the job kicked off in the legacy view.
      // TODO: once topic-slug routing is wired in the video page, use res.slug.
      router.push(`/${v2Suffix ? v2Suffix : ''}`);
    });
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <h2
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 500,
          fontSize: '22px',
          color: 'var(--ink-900)',
          letterSpacing: '-0.02em',
          margin: '0 0 6px',
          fontVariationSettings: '"opsz" 28, "SOFT" 20',
        }}
      >
        General / topic video
      </h2>
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '14px',
          color: 'var(--ink-500)',
          margin: '0 0 20px',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
          lineHeight: 1.55,
        }}
      >
        Rav Eli teaches on any topic — Torah, philosophy, relationships, health.
        Leave the field blank and AI will suggest a topic.
      </p>

      <label
        style={{
          display: 'block',
          fontFamily: 'var(--ff-body)',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--ink-700)',
          marginBottom: '6px',
          letterSpacing: '0.04em',
        }}
      >
        Topic (optional)
      </label>
      <input
        type="text"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="e.g. Why do bad things happen to good people?"
        style={{
          width: '100%',
          padding: '13px 14px',
          borderRadius: 'var(--r-md)',
          border: '1.5px solid var(--ink-200)',
          background: '#fff',
          fontFamily: 'var(--ff-body)',
          fontSize: '16px', // min 16px to prevent iOS zoom
          color: 'var(--ink-900)',
          outline: 'none',
          boxSizing: 'border-box',
          marginBottom: '8px',
          transition: 'border-color var(--trans)',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--navy-700)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--ink-200)'; }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
        disabled={isPending}
      />

      {error && (
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--tassel)',
            marginBottom: '8px',
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={handleStart}
        disabled={isPending}
        style={{
          width: '100%',
          marginTop: '6px',
          padding: '15px 20px',
          borderRadius: 'var(--r-md)',
          border: 'none',
          background: isPending ? 'var(--navy-300)' : 'var(--navy-700)',
          color: '#fff',
          fontFamily: 'var(--ff-body)',
          fontSize: '15px',
          fontWeight: 600,
          cursor: isPending ? 'wait' : 'pointer',
          minHeight: '44px',
          transition: 'background var(--trans)',
          letterSpacing: '0.01em',
        }}
      >
        {isPending ? 'Starting…' : 'Start →'}
      </button>
    </Sheet>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function StartNextVideoPicker({
  upcomingParsha,
  upcomingHoliday,
  allParshiot,
  v2Suffix,
}: Props) {
  const router = useRouter();
  const [showParshaPicker, setShowParshaPicker] = useState(false);
  const [showTopicSheet, setShowTopicSheet] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [activeCard, setActiveCard] = useState<'parsha' | 'holiday' | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  async function handleStartParsha(parshaId: string, parshaSlug: string, which: 'parsha' | 'holiday') {
    setActiveCard(which);
    setCardError(null);
    startTransition(async () => {
      const res = await startFromEmpty(parshaId, parshaSlug);
      if (!res.ok) {
        setCardError(res.error);
        setActiveCard(null);
        return;
      }
      router.push(`/videos/${parshaSlug}${v2Suffix}`);
    });
  }

  const shabbatDateFormatted = upcomingParsha?.shabbatDate
    ? new Date(upcomingParsha.shabbatDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    : null;
  const shabbatLabel = upcomingParsha
    ? upcomingParsha.isThisShabbat
      ? shabbatDateFormatted
        ? `This Shabbat · ${shabbatDateFormatted}`
        : 'This Shabbat'
      : shabbatDateFormatted
        ? `Next weekly parsha · ${shabbatDateFormatted}`
        : 'Next weekly parsha'
    : 'This Shabbat';

  return (
    <>
      {/* Section header */}
      <div
        style={{
          fontFamily: 'var(--ff-display)',
          fontWeight: 500,
          fontSize: '26px',
          color: 'var(--ink-900)',
          letterSpacing: '-0.025em',
          marginBottom: '20px',
          fontVariationSettings: '"opsz" 32, "SOFT" 20',
        }}
      >
        Start working on next video
      </div>

      {cardError && (
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--tassel)',
            marginBottom: '12px',
            padding: '10px 14px',
            border: '1px solid var(--cedar-300)',
            borderRadius: 'var(--r-md)',
            background: 'rgba(178,58,43,.04)',
          }}
        >
          {cardError}
        </div>
      )}

      {/* 2×2 grid (stacks to 1 col on mobile) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
          gap: '14px',
        }}
      >
        {/* Card 1: Upcoming parsha */}
        {upcomingParsha ? (
          <button
            onClick={() => handleStartParsha(upcomingParsha.id, upcomingParsha.slug, 'parsha')}
            disabled={isPending}
            style={{
              ...cardBase,
              border: activeCard === 'parsha'
                ? '1.5px solid var(--navy-700)'
                : '1.5px solid var(--ink-100)',
            }}
          >
            <div style={cardLabel}>{shabbatLabel}</div>
            <div style={cardTitle}>
              {upcomingParsha.name}
              {upcomingParsha.hebrew && (
                <span
                  lang="he"
                  dir="rtl"
                  style={{
                    fontFamily: 'var(--ff-hebrew)',
                    fontWeight: 400,
                    fontSize: '17px',
                    color: 'var(--ink-500)',
                    marginLeft: '10px',
                    verticalAlign: 'middle',
                  }}
                >
                  {upcomingParsha.hebrew}
                </span>
              )}
            </div>
            <div style={cardSub}>{upcomingParsha.book}</div>
            <div style={ctaBtn}>
              {activeCard === 'parsha' ? 'Starting…' : 'Start scripting →'}
            </div>
          </button>
        ) : (
          <div style={{ ...cardBase, opacity: 0.5, cursor: 'default' }}>
            <div style={cardLabel}>This Shabbat</div>
            <div style={cardTitle}>Parsha unavailable</div>
            <div style={cardSub}>Could not load Hebrew calendar</div>
          </div>
        )}

        {/* Card 2: Pick a different parsha */}
        <button
          onClick={() => setShowParshaPicker(true)}
          style={cardBase}
        >
          <div style={cardLabel}>All 54 parshiot</div>
          <div style={cardTitle}>Pick a different parsha</div>
          <div style={cardSub}>Browse all weekly portions</div>
          <div style={ctaBtn}>Browse →</div>
        </button>

        {/* Card 3: Upcoming holiday (only if within 30 days) */}
        {upcomingHoliday && (
          <button
            onClick={() => handleStartParsha(upcomingHoliday.id, upcomingHoliday.slug, 'holiday')}
            disabled={isPending}
            style={{
              ...cardBase,
              border: activeCard === 'holiday'
                ? '1.5px solid var(--cedar-600)'
                : '1.5px solid var(--cedar-300)',
              background: 'linear-gradient(180deg, rgba(168,114,47,.05) 0%, var(--linen-50) 80%)',
            }}
          >
            <div style={{ ...cardLabel, color: 'var(--cedar-700)' }}>
              Upcoming holiday · in {upcomingHoliday.days <= 0 ? 0 : upcomingHoliday.days} days
            </div>
            <div style={cardTitle}>{upcomingHoliday.name}</div>
            <div style={{ ...cardSub, color: 'var(--cedar-600)' }}>Special occasion video</div>
            <div style={{ ...ctaBtn, color: 'var(--cedar-700)' }}>
              {activeCard === 'holiday' ? 'Starting…' : 'Start scripting →'}
            </div>
          </button>
        )}

        {/* Card 4: General / topic video */}
        <button
          onClick={() => setShowTopicSheet(true)}
          style={{
            ...cardBase,
            border: '1.5px dashed var(--ink-200)',
          }}
        >
          <div style={cardLabel}>Any topic</div>
          <div style={cardTitle}>General video</div>
          <div style={cardSub}>AI writes a Rav Eli script from your idea</div>
          <div style={{ ...ctaBtn, color: 'var(--ink-700)' }}>+ Start a topic video</div>
        </button>
      </div>

      {/* Bottom sheets */}
      <ParshaPickerSheet
        open={showParshaPicker}
        onClose={() => setShowParshaPicker(false)}
        allParshiot={allParshiot}
        v2Suffix={v2Suffix}
      />
      <TopicVideoSheet
        open={showTopicSheet}
        onClose={() => setShowTopicSheet(false)}
        v2Suffix={v2Suffix}
      />
    </>
  );
}
