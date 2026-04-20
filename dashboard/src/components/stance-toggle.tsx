'use client';

import { useEffect, useState, useTransition } from 'react';
import { saveStance as persistStance } from '@/app/actions/save-stance';

type Stance = 'handson' | 'reviewer' | 'batch' | 'auto';

const STANCE_COPY: Record<Stance, { line: string; toast: string }> = {
  handson:  { line: 'Hands-on — you initiate every step.',
              toast: 'Nothing ships without your action.' },
  reviewer: { line: 'Reviewing each post before it ships.',
              toast: 'The system drafts; you approve.' },
  batch:    { line: 'Running batch-ahead — five weeks stocked.',
              toast: 'Approved weeks will ship on schedule.' },
  auto:     { line: 'Running on autopilot · weekly digest on Sunday.',
              toast: 'Videos will ship weekly without approval.' },
};

const CHOICES: { value: Stance; name: string; lede: string; consequence: string }[] = [
  {
    value: 'handson',
    name: 'Hands-on',
    lede: 'You initiate each step — generate, review, schedule, publish. Nothing happens unless you act.',
    consequence: 'Slowest rhythm. Requires your attention every week. Best for a new season when you want to feel each video.',
  },
  {
    value: 'reviewer',
    name: 'Reviewer',
    lede: 'System drafts and generates weekly. You approve each video before it ships.',
    consequence: 'You see every post before it goes out. Nothing ships without your approval.',
  },
  {
    value: 'batch',
    name: 'Batch-ahead',
    lede: 'System generates several weeks at a time. You pre-approve in sessions; approved weeks ship on their calendar.',
    consequence: 'Good for travel or intense weeks. Approved-ahead weeks ship without further check-in.',
  },
  {
    value: 'auto',
    name: 'Autopilot',
    lede: 'Full auto: generate, schedule, publish. You check in only when you want to.',
    consequence: 'Videos ship weekly without your approval. You still get a Sunday digest and can pause anytime.',
  },
];

interface StanceToggleProps {
  initialStance?: Stance;
}

export function StanceToggle({ initialStance = 'reviewer' }: StanceToggleProps) {
  const [currentStance, setCurrentStance] = useState<Stance>(initialStance);
  const [pendingStance, setPendingStance] = useState<Stance>(initialStance);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastNote, setToastNote] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const openSheet = () => {
    setPendingStance(currentStance);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
  };

  // The sheet is page-attached (position: absolute from the authenticated
  // shell), not viewport-fixed, so we DO NOT lock body overflow — the user
  // can scroll the page normally to see any part of a tall modal. Only the
  // Escape keybinding is owned here.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  // When the sheet opens, scroll it into view so it's not above/below the
  // user's current scroll position.
  useEffect(() => {
    if (!sheetOpen) return;
    // Next tick so layout has settled.
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [sheetOpen]);

  const saveStance = () => {
    const prev = currentStance;
    const next = pendingStance;
    setSaveError(null);

    // No-op: close and do nothing if unchanged.
    if (prev === next) {
      closeSheet();
      return;
    }

    startSaving(async () => {
      const res = await persistStance(next);
      if (res.ok) {
        setCurrentStance(next);
        closeSheet();
        const copy = STANCE_COPY[next];
        setToastMsg(`Stance saved — ${copy.line.replace(/\.$/, '')}.`);
        setToastNote(copy.toast);
        setToastVisible(true);
        setTimeout(() => setToastVisible(false), 3400);
      } else {
        setSaveError(res.error ?? 'Failed to save stance.');
      }
    });
  };

  return (
    <>
      {/* Stance line */}
      <div
        style={{
          fontFamily: 'var(--ff-display)',
          fontSize: '15px',
          fontStyle: 'italic',
          fontVariationSettings: '"opsz" 16, "SOFT" 60',
          color: 'var(--ink-700)',
          marginBottom: '56px',
          display: 'flex',
          alignItems: 'baseline',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: 'var(--jade)',
            display: 'inline-block',
            transform: 'translateY(-1px)',
            boxShadow: '0 0 0 3px rgba(90,110,61,.15)',
            animation: 'pulse-jade 2.4s ease-in-out infinite',
            flexShrink: 0,
          }}
        />
        <span>{STANCE_COPY[currentStance].line}</span>
        <button
          type="button"
          onClick={openSheet}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontFamily: 'var(--ff-body)',
            fontSize: '12px',
            fontStyle: 'normal',
            letterSpacing: '0.06em',
            color: 'var(--ink-500)',
            textTransform: 'uppercase',
            textDecoration: 'none',
            padding: '6px 12px 6px 10px',
            borderRadius: '999px',
            border: '1px solid var(--ink-200)',
            background: 'var(--linen-50)',
            transition: 'all var(--trans)',
            cursor: 'pointer',
            minHeight: '32px',
          }}
          className="stance-swap-btn"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ width: '13px', height: '13px', flexShrink: 0 }} aria-hidden="true">
            <path d="M10 3v3M10 14v3M4.8 4.8l2.1 2.1M13.1 13.1l2.1 2.1M3 10h3M14 10h3M4.8 15.2l2.1-2.1M13.1 6.9l2.1-2.1"/>
            <circle cx="10" cy="10" r="2.4"/>
          </svg>
          <span style={{ fontWeight: 500 }}>Change stance</span>
          <span
            style={{
              fontFamily: 'var(--ff-display)',
              fontSize: '10px',
              fontStyle: 'italic',
              letterSpacing: '0.02em',
              color: 'var(--cedar-600)',
              textTransform: 'none',
              paddingLeft: '8px',
              marginLeft: '2px',
              borderLeft: '1px solid var(--ink-200)',
            }}
          >
            live setting
          </span>
        </button>
      </div>

      {/* Stance sheet scrim */}
      {sheetOpen && (
        <div
          onClick={closeSheet}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 30,
            background: 'rgba(35,27,16,.38)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
          aria-hidden="true"
        />
      )}

      {/* Stance sheet — page-attached: the user scrolls the page to see any
          overflowing part rather than scrolling inside a captive container. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        style={{
          position: 'absolute',
          zIndex: 31,
          left: '50%',
          top: '48px',
          transform: sheetOpen ? 'translateX(-50%)' : 'translate(-50%, 20px)',
          width: 'min(560px, calc(100vw - 32px))',
          background: 'var(--linen-50)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-xl)',
          boxShadow: '0 30px 80px -30px rgba(35,27,16,.45)',
          opacity: sheetOpen ? 1 : 0,
          pointerEvents: sheetOpen ? 'auto' : 'none',
          transition: 'opacity var(--trans), transform var(--trans)',
          marginBottom: '32px',
        }}
      >
        {/* Body — header + radio options */}
        <div style={{ padding: '36px 40px 24px' }}>
          <div
            style={{
              fontFamily: 'var(--ff-body)',
              fontSize: '10.5px',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--cedar-600)',
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--cedar-500)', display: 'inline-block' }} />
            Live setting · changes how the business runs
          </div>
          <h2
            id="sheet-title"
            style={{
              fontFamily: 'var(--ff-display)',
              fontWeight: 400,
              fontSize: 'clamp(24px, 3vw, 32px)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              margin: '0 0 10px 0',
              color: 'var(--ink-900)',
              fontVariationSettings: '"opsz" 36, "SOFT" 30',
            }}
          >
            How involved are you this season, <em style={{ fontStyle: 'italic', color: 'var(--ink-500)' }}>Yonah?</em>
          </h2>
          <p
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '14px',
              color: 'var(--ink-500)',
              margin: '0 0 24px 0',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
            }}
          >
            <strong style={{ fontWeight: 500, fontStyle: 'normal', color: 'var(--ink-700)' }}>This is not a view toggle.</strong>{' '}
            Changing your stance changes what Torah Tai Chi does on its own.
          </p>

          <div role="radiogroup" aria-label="Stance" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {CHOICES.map((choice) => {
            const selected = pendingStance === choice.value;
            return (
              <label
                key={choice.value}
                style={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr',
                  gap: '14px',
                  alignItems: 'start',
                  padding: '16px 18px',
                  border: `1px solid ${selected ? 'var(--navy-500)' : 'var(--ink-100)'}`,
                  borderRadius: 'var(--r-md)',
                  background: selected ? 'var(--navy-wash)' : 'var(--linen-50)',
                  cursor: 'pointer',
                  transition: 'all var(--trans)',
                }}
                onClick={() => setPendingStance(choice.value)}
              >
                <input type="radio" name="stance" value={choice.value} checked={selected} onChange={() => setPendingStance(choice.value)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                <span
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    border: `1.5px solid ${selected ? 'var(--navy-800)' : 'var(--ink-300)'}`,
                    background: 'var(--linen-50)',
                    display: 'grid',
                    placeItems: 'center',
                    marginTop: '3px',
                    transition: 'all var(--trans)',
                    flexShrink: 0,
                  }}
                >
                  {selected && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--navy-800)', display: 'block' }} />
                  )}
                </span>
                <div>
                  <p style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '16px', color: 'var(--ink-900)', letterSpacing: '-0.005em', margin: '0 0 3px 0', fontVariationSettings: '"opsz" 18, "SOFT" 20' }}>
                    {choice.name}
                    {choice.value === currentStance && (
                      <span style={{ fontFamily: 'var(--ff-body)', fontStyle: 'normal', fontSize: '11px', color: 'var(--navy-700)', letterSpacing: '.08em', textTransform: 'uppercase', marginLeft: '10px', padding: '2px 8px', background: 'var(--navy-wash)', borderRadius: '999px', verticalAlign: 'middle' }}>current</span>
                    )}
                  </p>
                  <p style={{ fontSize: '13.5px', color: 'var(--ink-700)', margin: 0, lineHeight: 1.45 }}>{choice.lede}</p>
                  <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12.5px', color: 'var(--ink-500)', marginTop: '7px', paddingTop: '7px', borderTop: '1px dotted var(--ink-100)', lineHeight: 1.5, fontVariationSettings: '"opsz" 14, "SOFT" 60' }}>{choice.consequence}</p>
                </div>
              </label>
            );
          })}
          </div>
        </div>

        {/* Pinned footer — always visible regardless of viewport height */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 40px 20px',
            borderTop: '1px solid var(--ink-100)',
            background: 'var(--linen-50)',
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12.5px', color: saveError ? 'var(--cedar-600)' : 'var(--ink-500)', minWidth: '200px', lineHeight: 1.45 }}>
            {saveError
              ? `Couldn't save: ${saveError}`
              : 'You can change this anytime. Work already in-flight won\u2019t be affected.'}
          </div>
          <button
            type="button"
            onClick={closeSheet}
            disabled={isSaving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--ff-body)', fontWeight: 500, fontSize: '14px', padding: '11px 22px', minHeight: '44px', borderRadius: '999px', border: '1px solid var(--ink-200)', background: 'transparent', color: 'var(--ink-700)', cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.5 : 1, transition: 'all var(--trans)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveStance}
            disabled={isSaving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--ff-body)', fontWeight: 500, fontSize: '14px', padding: '11px 22px', minHeight: '44px', borderRadius: '999px', border: '1px solid var(--navy-800)', background: 'var(--navy-800)', color: 'var(--linen-50)', cursor: isSaving ? 'wait' : 'pointer', opacity: isSaving ? 0.7 : 1, transition: 'all var(--trans)', boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)' }}
          >
            {isSaving ? 'Saving…' : 'Save stance'}
          </button>
        </div>
      </div>

      {/* Toast */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          zIndex: 40,
          bottom: '28px',
          left: '50%',
          transform: toastVisible ? 'translate(-50%, 0)' : 'translate(-50%, 40px)',
          padding: '12px 20px 12px 16px',
          background: 'var(--ink-900)',
          color: 'var(--linen-50)',
          borderRadius: '999px',
          fontFamily: 'var(--ff-body)',
          fontSize: '13.5px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          opacity: toastVisible ? 1 : 0,
          pointerEvents: 'none',
          transition: 'all var(--trans)',
          boxShadow: '0 20px 40px -20px rgba(35,27,16,.4)',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: 'var(--jade)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--linen-50)',
            flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: '10px', height: '10px' }}>
            <path d="M2.5 6.2l2.4 2.3 4.6-4.8"/>
          </svg>
        </span>
        <span>{toastMsg}</span>
        <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', color: 'var(--cedar-300)', marginLeft: '6px', fontSize: '12.5px' }}>{toastNote}</span>
      </div>
    </>
  );
}
