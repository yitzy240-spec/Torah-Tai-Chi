// dashboard/src/app/videos/[slug]/_components/phase-1-script.tsx
//
// Phase 1: Script editor. A-tight loads by default. Inline word/duration/wps
// feedback. "Try another" reveals the stacked script list. Sticky bottom
// "Next: review clip plan →" advances to Phase 2.
//
// Per spec §4 Phase 1. Mockup: 11-phase1-scripts.html option B.

'use client';
import { useState } from 'react';
import { useLocalStorageDraft } from '@/hooks/use-localstorage-draft';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';
import { analyzeScript } from '@/lib/word-count';
import { saveScript } from '@/app/actions/video-page/save-script';

interface Script {
  id: string;
  option: string;
  title: string | null;
  draft_text: string | null;
}

interface Props {
  parshaSlug: string;
  scripts: Script[]; // all variants (A / A-tight / B / C)
  defaultScript: Script; // A-tight or whatever was last edited
  onAdvance: () => void; // tap "Next: review clip plan →"
}

export function Phase1Script({ parshaSlug, scripts, defaultScript, onAdvance }: Props) {
  const [selectedId, setSelectedId] = useState<string>(defaultScript.id);
  const [showOthers, setShowOthers] = useState(false);

  const selected = scripts.find((s) => s.id === selectedId) ?? defaultScript;

  const [localText, setLocalText, clearDraft] = useLocalStorageDraft(
    `script.${parshaSlug}.${selected.id}`,
    selected.draft_text ?? '',
  );

  const { update, isPending } = useOptimisticSave<string>({
    current: localText,
    save: async (next) => {
      await saveScript(selected.id, next);
    },
    onSuccess: clearDraft,
    errorMessage: 'Saving the script failed.',
  });

  const fb = analyzeScript(localText);

  return (
    <section>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--ff-display)',
            fontSize: 22,
            margin: 0,
            color: 'var(--ink-900)',
          }}
        >
          Edit the script
        </h2>
        <button
          type="button"
          onClick={() => setShowOthers((x) => !x)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--navy-700)',
            textDecoration: 'underline',
            fontSize: 13,
            cursor: 'pointer',
            minHeight: 44,
            padding: '0 4px',
          }}
        >
          {showOthers ? 'Hide alternates' : 'Try another'}
        </button>
      </div>

      {/* Stacked list of script options — visible only when "Try another" is tapped */}
      {showOthers && (
        <div style={{ marginBottom: 16 }}>
          {scripts.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSelectedId(s.id);
                setShowOthers(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: 12,
                marginBottom: 6,
                border: `1px solid ${s.id === selectedId ? 'var(--navy-700)' : 'var(--ink-100)'}`,
                borderRadius: 8,
                background: s.id === selectedId ? 'var(--linen-50)' : 'white',
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              <strong style={{ fontSize: 13, color: 'var(--ink-900)' }}>{s.option}</strong>
              {s.title && (
                <div style={{ fontSize: 12, color: 'var(--ink-700)', marginTop: 2 }}>
                  {s.title}
                </div>
              )}
              <div style={{ color: 'var(--ink-500)', fontSize: 12, marginTop: 4 }}>
                {(s.draft_text ?? '').slice(0, 80)}
                {(s.draft_text ?? '').length > 80 ? '…' : ''}
              </div>
            </button>
          ))}
        </div>
      )}

      <textarea
        value={localText}
        onChange={(e) => {
          setLocalText(e.target.value);
          update(e.target.value);
        }}
        style={{
          width: '100%',
          minHeight: 240,
          padding: 12,
          border: '1px solid var(--ink-100)',
          borderRadius: 8,
          fontSize: 16, // 16pt prevents iOS auto-zoom
          lineHeight: 1.5,
          background: 'white',
          color: 'var(--ink-900)',
          fontFamily: 'var(--ff-body)',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />

      {/* Live word count + wps feedback */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '10px 12px',
          marginTop: 8,
          background: 'var(--linen-50)',
          borderRadius: 8,
          fontSize: 12,
        }}
      >
        <span style={{ color: 'var(--ink-700)' }}>
          {fb.words} words · ~{Math.round(fb.estimatedSeconds)}s · {fb.wps.toFixed(1)} wps
        </span>
        <span style={{ color: fb.fits60s ? 'var(--jade)' : 'var(--tassel)', fontWeight: 500 }}>
          {fb.fits60s ? 'fits 60s ✓' : 'over 60s ⚠'}
        </span>
      </div>

      {/* Sticky bottom action bar per spec §7 */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'white',
          borderTop: '1px solid var(--ink-100)',
          padding: 'max(12px, env(safe-area-inset-bottom)) 0 max(16px, env(safe-area-inset-bottom))',
          marginTop: 18,
        }}
      >
        <button
          type="button"
          onClick={onAdvance}
          disabled={isPending}
          style={{
            width: '100%',
            minHeight: 48,
            fontSize: 15,
            fontWeight: 500,
            background: 'var(--navy-700)',
            color: 'var(--linen-50)',
            border: 'none',
            borderRadius: 10,
            padding: 14,
            cursor: isPending ? 'wait' : 'pointer',
            opacity: isPending ? 0.7 : 1,
          }}
        >
          Next: review clip plan →
        </button>
      </div>
    </section>
  );
}
