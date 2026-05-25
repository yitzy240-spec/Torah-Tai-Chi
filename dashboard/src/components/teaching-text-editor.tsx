'use client';

import { useState, useTransition } from 'react';
import { updateTeachingText } from '@/app/actions/update-teaching-text';
import { updateScriptMeta } from '@/app/actions/update-script-meta';

interface Props {
  videoId: string;
  /** Source script id for the live published video (null if we couldn't
   *  resolve one via the job chain). When null, title/tldr inputs are
   *  hidden and only the teaching text is editable. */
  scriptId: string | null;
  initialTitle: string;
  initialTldr: string;
  initialText: string;
  parshaSlug: string;
}

/**
 * Backend-preview + inline-edit panel for the live published video's
 * public-facing content (title, subtitle, teaching paragraphs). Default
 * state is VIEW — a read-only preview of what's currently rendered on
 * torahtaichi.com. Clicking Edit reveals form controls; Update saves
 * everything atomically and exits back to view; Cancel reverts.
 *
 * Saves:
 *   - title + tldr → scripts.title / scripts.tldr via updateScriptMeta
 *   - text         → videos.spoken_script via updateTeachingText
 *
 * Both actions bust the public website's ISR cache; edits go live
 * within ~60s.
 */
export function TeachingTextEditor({
  videoId,
  scriptId,
  initialTitle,
  initialTldr,
  initialText,
  parshaSlug,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [tldr, setTldr] = useState(initialTldr);
  const [text, setText] = useState(initialText);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [savedTldr, setSavedTldr] = useState(initialTldr);
  const [savedText, setSavedText] = useState(initialText);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty =
    title !== savedTitle || tldr !== savedTldr || text !== savedText;

  function handleUpdate() {
    setError(null);
    startTransition(async () => {
      const tasks: Promise<{ ok: true } | { error: string }>[] = [];
      if (
        scriptId
        && (title !== savedTitle || tldr !== savedTldr)
      ) {
        tasks.push(updateScriptMeta({ scriptId, title, tldr, parshaSlug }));
      }
      if (text !== savedText) {
        tasks.push(updateTeachingText({ videoId, text, parshaSlug }));
      }
      const results = await Promise.all(tasks);
      const firstError = results.find((r) => 'error' in r);
      if (firstError) {
        setError((firstError as { error: string }).error);
        return;
      }
      setSavedTitle(title);
      setSavedTldr(tldr);
      setSavedText(text);
      setEditing(false);
    });
  }

  function handleCancel() {
    setTitle(savedTitle);
    setTldr(savedTldr);
    setText(savedText);
    setError(null);
    setEditing(false);
  }

  // Render paragraphs by splitting on \n\n. Same shape the public site uses.
  const paragraphs = savedText.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  return (
    <section
      style={{
        padding: '26px 30px',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--linen-50)',
        marginBottom: 32,
        position: 'relative',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 18,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: 10.5,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--cedar-600)',
            fontWeight: 500,
          }}
        >
          Live on torahtaichi.com
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: 12.5,
              padding: '7px 14px',
              minHeight: 32,
              borderRadius: '999px',
              border: '1px solid var(--ink-200)',
              background: 'white',
              color: 'var(--ink-700)',
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
        )}
      </header>

      {editing ? (
        <>
          {scriptId && (
            <>
              <label
                style={{
                  display: 'block',
                  fontFamily: 'var(--ff-body)',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--cedar-600)',
                  marginBottom: 4,
                }}
              >
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={pending}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--ff-display)',
                  fontWeight: 500,
                  fontSize: 22,
                  padding: '10px 12px',
                  border: '1px solid var(--ink-200)',
                  borderRadius: 'var(--r-sm)',
                  background: 'white',
                  color: 'var(--ink-900)',
                  outline: 'none',
                  marginBottom: 16,
                }}
              />
              <label
                style={{
                  display: 'block',
                  fontFamily: 'var(--ff-body)',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--cedar-600)',
                  marginBottom: 4,
                }}
              >
                Teaser
              </label>
              <textarea
                value={tldr}
                onChange={(e) => setTldr(e.target.value)}
                rows={2}
                disabled={pending}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--ff-display)',
                  fontStyle: 'italic',
                  fontSize: 15,
                  lineHeight: 1.5,
                  padding: '10px 12px',
                  border: '1px solid var(--ink-200)',
                  borderRadius: 'var(--r-sm)',
                  background: 'white',
                  color: 'var(--ink-700)',
                  outline: 'none',
                  resize: 'vertical',
                  marginBottom: 18,
                }}
              />
            </>
          )}
          <label
            style={{
              display: 'block',
              fontFamily: 'var(--ff-body)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--cedar-600)',
              marginBottom: 4,
            }}
          >
            Teaching text
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
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
              outline: 'none',
              resize: 'vertical',
              color: 'var(--ink-900)',
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 16,
            }}
          >
            <button
              type="button"
              onClick={handleUpdate}
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
              {pending ? 'Updating…' : 'Update page'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              style={{
                fontFamily: 'var(--ff-body)',
                fontSize: 13,
                padding: '11px 18px',
                minHeight: 44,
                borderRadius: '999px',
                border: '1px solid var(--ink-200)',
                background: 'transparent',
                color: 'var(--ink-700)',
                cursor: pending ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            {error && (
              <span style={{ fontSize: 12.5, color: 'var(--tassel)' }}>
                {error}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          {savedTitle && (
            <h2
              style={{
                fontFamily: 'var(--ff-display)',
                fontWeight: 500,
                fontSize: 26,
                lineHeight: 1.15,
                color: 'var(--ink-900)',
                margin: '0 0 10px 0',
                fontVariationSettings: '"opsz" 32, "SOFT" 30',
              }}
            >
              {savedTitle}
            </h2>
          )}
          {savedTldr && (
            <p
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: 15.5,
                lineHeight: 1.5,
                color: 'var(--ink-500)',
                margin: '0 0 22px 0',
                fontVariationSettings: '"opsz" 18, "SOFT" 50',
              }}
            >
              {savedTldr}
            </p>
          )}
          {paragraphs.length > 0 ? (
            <div
              style={{
                fontFamily: 'var(--ff-reading)',
                fontSize: 14.5,
                lineHeight: 1.7,
                color: 'var(--ink-800)',
              }}
            >
              {paragraphs.map((p, i) => (
                <p key={i} style={{ margin: i === 0 ? 0 : '14px 0 0 0' }}>
                  {p}
                </p>
              ))}
            </div>
          ) : (
            <p
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: 13,
                color: 'var(--ink-400)',
              }}
            >
              No teaching text yet. Click Edit to add one.
            </p>
          )}
        </>
      )}
    </section>
  );
}
