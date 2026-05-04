'use client';

import { useState } from 'react';

/**
 * "How this works" pill button + modal explainer for the video detail
 * page's editing surface. Clarifies the relationship between the script
 * (title/teaser metadata) and the per-clip text edits, and sets cost
 * expectations for re-renders.
 */
export function EditingHelpModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="What does this page do?"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--ff-body)',
          fontSize: 12.5,
          color: 'var(--ink-500)',
          background: 'none',
          border: '1px solid var(--ink-200)',
          borderRadius: '999px',
          padding: '4px 12px',
          cursor: 'pointer',
        }}
      >
        ? How this works
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 480,
              background: 'var(--linen-50)',
              borderRadius: 'var(--r-lg)',
              padding: '28px 32px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <h2
              style={{
                fontFamily: 'var(--ff-display)',
                fontWeight: 500,
                fontSize: 20,
                color: 'var(--ink-900)',
                margin: '0 0 16px',
              }}
            >
              How this page works
            </h2>
            <ul
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: 14,
                color: 'var(--ink-700)',
                lineHeight: 1.65,
                paddingLeft: 18,
                margin: 0,
              }}
            >
              <li>This page is everything for one parsha video.</li>
              <li>Edit the title and teaser at the top — those show on the dashboard and the public site.</li>
              <li>Edit each clip&apos;s words below — those affect what Seedance speaks.</li>
              <li>Hit Re-render on a clip to apply your edits. Each re-render costs about $1.20.</li>
              <li>The final video stitches together the selected version of each clip.</li>
            </ul>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                marginTop: 22,
                fontFamily: 'var(--ff-body)',
                fontSize: 13,
                padding: '8px 18px',
                borderRadius: '999px',
                border: '1px solid var(--ink-200)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
