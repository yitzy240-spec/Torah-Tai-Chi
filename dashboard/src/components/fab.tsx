'use client';

import { useState } from 'react';

export function Fab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  const openCreate = () => {
    setCreateOpen(true);
    document.body.style.overflow = 'hidden';
  };

  const closeCreate = () => {
    setCreateOpen(false);
    document.body.style.overflow = '';
  };

  const submit = () => {
    closeCreate();
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3400);
  };

  return (
    <>
      {/* FAB */}
      <button
        type="button"
        aria-label="New video"
        onClick={openCreate}
        style={{
          position: 'fixed',
          zIndex: 25,
          bottom: '36px',
          right: '36px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'var(--navy-800)',
          color: 'var(--linen-50)',
          border: 'none',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          boxShadow: '0 4px 14px -4px rgba(19,30,56,.45), 0 1px 0 rgba(255,255,255,.06) inset',
          transition: 'all var(--trans)',
        }}
        className="fab-btn"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: '24px', height: '24px' }}>
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span
          style={{
            position: 'absolute',
            right: '66px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'var(--ink-900)',
            color: 'var(--linen-50)',
            fontFamily: 'var(--ff-body)',
            fontSize: '12px',
            fontWeight: 500,
            padding: '5px 10px',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            opacity: 0,
            pointerEvents: 'none',
            transition: 'opacity 180ms ease',
          }}
          className="fab-tooltip"
        >
          New video
        </span>
      </button>

      {/* Create scrim */}
      {createOpen && (
        <div
          onClick={closeCreate}
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

      {/* Create sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
        style={{
          position: 'fixed',
          zIndex: 31,
          left: '50%',
          top: '50%',
          transform: createOpen ? 'translate(-50%, -50%)' : 'translate(-50%, calc(-50% + 20px))',
          width: 'min(600px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: 'var(--linen-50)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-xl)',
          boxShadow: '0 30px 80px -30px rgba(35,27,16,.45)',
          padding: '36px 40px 32px',
          opacity: createOpen ? 1 : 0,
          pointerEvents: createOpen ? 'auto' : 'none',
          transition: 'opacity var(--trans), transform var(--trans)',
        }}
      >
        <div style={{ fontFamily: 'var(--ff-body)', fontSize: '10.5px', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--cedar-600)', marginBottom: '8px' }}>
          CREATE · NEW VIDEO
        </div>
        <h2
          id="create-title"
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 400,
            fontSize: 'clamp(24px, 3vw, 32px)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: '0 0 6px 0',
            color: 'var(--ink-900)',
            fontStyle: 'italic',
            fontVariationSettings: '"opsz" 36, "SOFT" 50',
          }}
        >
          What&apos;s on your mind?
        </h2>
        <p style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '14px', color: 'var(--ink-500)', margin: '0 0 24px 0', fontVariationSettings: '"opsz" 14, "SOFT" 50', lineHeight: 1.5 }}>
          Speak or type an idea. Claude will draft a script in the Torah Tai Chi voice.
        </p>

        {/* Text input. Voice capture is on the roadmap but not yet wired
            (see HANDOFF.md long-tail) — hiding the toggle until then to
            avoid the dead 'Tap to record' button. */}
        <div style={{ padding: '4px 0 8px' }}>
          <textarea
            placeholder="A teaching, a response to something in the news, a holiday thought..."
            style={{
              width: '100%',
              minHeight: '120px',
              padding: '16px',
              fontFamily: 'var(--ff-reading)',
              fontSize: '15px',
              lineHeight: 1.6,
              color: 'var(--ink-800)',
              background: 'var(--linen-100)',
              border: '1px solid var(--cedar-100)',
              borderRadius: 'var(--r-md)',
              resize: 'vertical',
              fontVariationSettings: '"opsz" 16, "SOFT" 30',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Category pills */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '16px 0 24px' }}>
          {['Torah insight', 'Holiday', 'Topical', 'Announcement'].map((cat) => (
            <button
              key={cat}
              type="button"
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: '12px',
                fontWeight: 500,
                padding: '6px 14px',
                minHeight: '32px',
                borderRadius: '999px',
                border: '1px solid var(--ink-200)',
                background: 'transparent',
                color: 'var(--ink-500)',
                cursor: 'pointer',
                transition: 'all var(--trans)',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '20px', borderTop: '1px solid var(--ink-100)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12.5px', color: 'var(--ink-500)', minWidth: '200px', lineHeight: 1.45, fontVariationSettings: '"opsz" 14, "SOFT" 50' }}>
            Claude will return a ~100-word script in about 15 seconds.
          </div>
          <button
            type="button"
            onClick={closeCreate}
            style={{ display: 'inline-flex', alignItems: 'center', fontFamily: 'var(--ff-body)', fontWeight: 500, fontSize: '14px', padding: '11px 22px', minHeight: '44px', borderRadius: '999px', border: '1px solid var(--ink-200)', background: 'transparent', color: 'var(--ink-700)', cursor: 'pointer', transition: 'all var(--trans)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            style={{ display: 'inline-flex', alignItems: 'center', fontFamily: 'var(--ff-body)', fontWeight: 500, fontSize: '14px', padding: '11px 22px', minHeight: '44px', borderRadius: '999px', border: '1px solid var(--navy-800)', background: 'var(--navy-800)', color: 'var(--linen-50)', cursor: 'pointer', transition: 'all var(--trans)', boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -10px rgba(19,30,56,.42)' }}
          >
            Draft script →
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
        <span style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'var(--jade)', display: 'grid', placeItems: 'center', color: 'var(--linen-50)', flexShrink: 0 }}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: '10px', height: '10px' }}>
            <path d="M2.5 6.2l2.4 2.3 4.6-4.8"/>
          </svg>
        </span>
        <span>Claude is drafting your script…</span>
        <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', color: 'var(--cedar-300)', marginLeft: '6px', fontSize: '12.5px' }}>This usually takes about 15 seconds.</span>
      </div>
    </>
  );
}
