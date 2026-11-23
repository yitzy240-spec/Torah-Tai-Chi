// On-screen hook + spoken captions (Phase 4). Saved on the videos row and
// applied by re-stitching the same clips (no new Seedance render). Text
// is burned into the middle reel safe zone, never over the end card.
'use client';
import { useEffect, useRef, useState } from 'react';
import { restitchVideo } from '@/app/actions/restitch-video';
import { saveOnScreenText } from '@/app/actions/video-page/save-on-screen-text';
import { defaultBurnOnScreenText, type OnScreenTextFields } from '@/lib/on-screen-text';
import type { CutType } from '../_data/phase-4-data';

interface Props {
  videoId: string;
  hookText: string;
  captionOverride: string;
  enabled: boolean;
  /** Current transition overrides, forwarded so a re-stitch does not drop them. */
  cutOverrides: Record<string, CutType>;
  onRestitchStart: () => void;
}

const box: React.CSSProperties = {
  border: '1px solid var(--ink-100)', borderRadius: 10, marginTop: 14,
  background: 'var(--linen-50)', overflow: 'hidden',
};

const field: React.CSSProperties = {
  width: '100%', fontSize: 14, lineHeight: 1.4, color: 'var(--ink-900)',
  background: 'white', border: '1px solid var(--ink-200)', borderRadius: 8,
  padding: '10px 12px', boxSizing: 'border-box', fontFamily: 'inherit',
};

const label: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-700)',
  marginBottom: 6,
};

export function OnScreenTextControl({
  videoId, hookText, captionOverride, enabled, cutOverrides, onRestitchStart,
}: Props) {
  const [expanded, setExpanded] = useState(
    () => enabled || Boolean(hookText.trim() || captionOverride.trim()),
  );
  const [hook, setHook] = useState(hookText);
  const [override, setOverride] = useState(captionOverride);
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touchedToggle = useRef(enabled || !defaultBurnOnScreenText(hookText, captionOverride));

  useEffect(() => {
    setHook(hookText);
    setOverride(captionOverride);
    setOn(enabled);
  }, [hookText, captionOverride, enabled]);

  function onHookChange(value: string) {
    setHook(value);
    if (!touchedToggle.current) setOn(defaultBurnOnScreenText(value, override));
  }
  function onOverrideChange(value: string) {
    setOverride(value);
    if (!touchedToggle.current) setOn(defaultBurnOnScreenText(hook, value));
  }
  function onToggle(value: boolean) {
    touchedToggle.current = true;
    setOn(value);
  }

  const fields: OnScreenTextFields = {
    hookText: hook, captionOverride: override, enabled: on,
  };
  const dirty =
    hook !== hookText || override !== captionOverride || on !== enabled;

  const summary = on
    ? (hook.trim() ? 'On — hook + captions' : 'On — captions')
    : 'Off';

  async function onApply() {
    setBusy(true);
    setError(null);
    const saved = await saveOnScreenText({ videoId, fields });
    if ('error' in saved) {
      setBusy(false);
      setError(saved.error);
      return;
    }
    const res = await restitchVideo({ videoId, cuts: cutOverrides });
    setBusy(false);
    if ('error' in res) { setError(res.error); return; }
    onRestitchStart();
  }

  if (!expanded) {
    return (
      <div style={box}>
        <button type="button" onClick={() => setExpanded(true)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', minHeight: 48, background: 'transparent', border: 'none',
            cursor: 'pointer', fontSize: 13, color: 'var(--ink-700)' }}>
          <span>On-screen text: <strong style={{ color: 'var(--ink-900)' }}>{summary}</strong></span>
          <span aria-hidden style={{ color: 'var(--ink-400)' }}>Edit ▾</span>
        </button>
      </div>
    );
  }

  return (
    <div style={box}>
      <button type="button" onClick={() => setExpanded(false)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px', minHeight: 48, background: 'transparent', border: 'none',
          cursor: 'pointer', fontSize: 13, color: 'var(--ink-700)', borderBottom: '1px solid var(--ink-100)' }}>
        <span>On-screen text: <strong style={{ color: 'var(--ink-900)' }}>{summary}</strong></span>
        <span aria-hidden style={{ color: 'var(--ink-400)' }}>Hide ▴</span>
      </button>
      <div style={{ padding: 14 }}>
        <p style={{ fontSize: 12, color: 'var(--ink-500)', margin: '0 0 12px', lineHeight: 1.45 }}>
          Burned onto the video after stitching, in the middle safe zone
          (away from app buttons and the caption bar). Nothing is written
          over the Follow / Subscribe end card. Re-stitching is free — no
          new clip render.
        </p>

        <label style={label} htmlFor="hook-text">Hook line (first 3 seconds)</label>
        <input
          id="hook-text"
          type="text"
          value={hook}
          maxLength={80}
          placeholder="e.g. Why did Lavan run?"
          onChange={(e) => onHookChange(e.target.value)}
          style={{ ...field, marginBottom: 12 }}
        />

        <label style={label} htmlFor="caption-override">
          Caption override (optional)
        </label>
        <textarea
          id="caption-override"
          value={override}
          rows={4}
          placeholder="Leave blank to caption the spoken script word for word. Fill this in if the script uses pronunciation spellings (like Sha-BAHT) that viewers shouldn't see."
          onChange={(e) => onOverrideChange(e.target.value)}
          style={{ ...field, minHeight: 88, resize: 'vertical', marginBottom: 12 }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
          color: 'var(--ink-800)', minHeight: 44, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => onToggle(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          Burn captions onto the video
        </label>

        {error && (
          <p role="alert" style={{ color: 'var(--tassel, #B23A2B)', fontSize: 12, margin: '8px 0 0' }}>
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onApply}
          disabled={busy || (!dirty && !on && !enabled)}
          style={{
            width: '100%', minHeight: 44, marginTop: 12, fontSize: 14, fontWeight: 500,
            background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none',
            borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Applying…' : 'Save and apply (re-stitch)'}
        </button>
      </div>
    </div>
  );
}
