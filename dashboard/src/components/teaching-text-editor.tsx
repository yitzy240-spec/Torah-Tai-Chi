'use client';

import { useState, useTransition } from 'react';
import { updateTeachingText } from '@/app/actions/update-teaching-text';

interface Props {
  videoId: string;
  initialText: string;
  parshaSlug: string;
  /** True when this is the version currently published to the public
   *  site. Used to color the help text so Yonah knows whether his edit
   *  goes live immediately. */
  isPublished: boolean;
}

/**
 * Editor for the public teaching text (videos.spoken_script) shown
 * under "THE TEACHING" on torahtaichi.com. Bound to the selected
 * video in the top player.
 *
 * Save is explicit (button), not auto-debounce: the text is long
 * (~800 chars) and Yonah is rewriting paragraphs, not single chars —
 * incremental saves would just thrash and the auto-saved "Saving…"
 * indicator would distract from the proofread flow.
 */
export function TeachingTextEditor({
  videoId,
  initialText,
  parshaSlug,
  isPublished,
}: Props) {
  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== savedText;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const r = await updateTeachingText({ videoId, text, parshaSlug });
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setSavedText(text);
      setSavedAt(Date.now());
    });
  }

  return (
    <section
      style={{
        padding: '24px 26px',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--linen-50)',
        marginBottom: 32,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 4,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--ff-display)',
            fontWeight: 500,
            fontSize: 15,
            color: 'var(--ink-900)',
            margin: 0,
            fontVariationSettings: '"opsz" 18, "SOFT" 30',
          }}
        >
          Teaching text
        </h2>
        <span
          style={{
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: 12,
            color: 'var(--ink-400)',
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}
        >
          {text.trim() ? `${text.trim().length} chars` : 'empty'}
        </span>
      </header>
      <p
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: 12.5,
          color: 'var(--ink-400)',
          margin: '0 0 14px 0',
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        {isPublished
          ? "This is what appears under THE TEACHING on torahtaichi.com. Edits go live within ~60 s."
          : "Edits save now. Will appear on torahtaichi.com when this version is published."}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        disabled={pending}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: 'var(--ff-reading)',
          fontSize: 14.5,
          lineHeight: 1.65,
          padding: '12px 14px',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--r-sm)',
          background: 'white',
          resize: 'vertical',
          outline: 'none',
          color: 'var(--ink-900)',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 12,
        }}
      >
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || pending}
          style={{
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: 13.5,
            padding: '11px 22px',
            minHeight: 44,
            borderRadius: '999px',
            border: '1px solid var(--navy-800)',
            background: !dirty || pending ? 'var(--ink-200)' : 'var(--navy-800)',
            color: 'var(--linen-50)',
            cursor: !dirty || pending ? 'not-allowed' : 'pointer',
            opacity: !dirty || pending ? 0.6 : 1,
          }}
        >
          {pending ? 'Updating…' : dirty ? 'Update page' : 'Saved'}
        </button>
        {savedAt && !dirty && !pending && (
          <span
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: 12.5,
              color: 'var(--jade)',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
            }}
          >
            Saved · live on the public site
          </span>
        )}
        {error && (
          <span style={{ fontSize: 12.5, color: 'var(--tassel)' }}>
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
