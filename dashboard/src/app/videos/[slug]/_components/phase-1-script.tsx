// dashboard/src/app/videos/[slug]/_components/phase-1-script.tsx
//
// Phase 1: Script editor — 4-mode picker.
//   - "Pick AI variant"   existing AI-generated variants list + editor
//   - "Write my own"      blank textarea + metrics
//   - "From an idea"      text/mic input → AI draft
//   - "AI polish"         current text → Claude polish → inline diff
//
// Per spec §4 Phase 1 (B3 milestone).

'use client';
import { useState } from 'react';
import { diffWords } from 'diff';
import type { Change } from 'diff';
import { toast } from 'sonner';
import { useLocalStorageDraft } from '@/hooks/use-localstorage-draft';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';
import { analyzeScript } from '@/lib/word-count';
import { saveScript } from '@/app/actions/video-page/save-script';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Script {
  id: string;
  option: string;
  title: string | null;
  draft_text: string | null;
}

type TabKind = 'pick' | 'write' | 'from-idea';

type FromIdeaStatus = 'idle' | 'generating' | 'done';
type PolishStatus = 'idle' | 'polishing' | 'reviewing';

interface PolishState {
  original: string;
  polished: string | null;
  status: PolishStatus;
}

interface Props {
  parshaSlug: string;
  scripts: Script[];
  defaultScript: Script;
  onAdvance: () => void;
  advancing?: boolean;
}

// ---------------------------------------------------------------------------
// Metrics row (shared across write / from-idea done / polish)
// ---------------------------------------------------------------------------

function MetricsRow({ text }: { text: string }) {
  const fb = analyzeScript(text);
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 12px',
        marginTop: 8,
        background: 'var(--linen-50)',
        borderRadius: 8,
        fontSize: 12,
        flexWrap: 'wrap',
        gap: 4,
      }}
    >
      <span style={{ color: 'var(--ink-700)' }}>
        {fb.words} words &middot; ~{Math.round(fb.estimatedSeconds)}s &middot;{' '}
        {fb.wps.toFixed(1)} wps &middot; ~{fb.clipCountEstimate} clips
      </span>
      <span
        style={{
          color: fb.fits60s ? 'var(--jade)' : 'var(--tassel)',
          fontWeight: 500,
        }}
      >
        {fb.fits60s ? 'fits 60s ✓' : 'over 60s ⚠'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared textarea style
// ---------------------------------------------------------------------------

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 240,
  padding: 12,
  border: '1px solid var(--ink-100)',
  borderRadius: 8,
  fontSize: 16,
  lineHeight: 1.5,
  background: 'white',
  color: 'var(--ink-900)',
  fontFamily: 'var(--ff-body)',
  resize: 'vertical',
  boxSizing: 'border-box',
};

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const TABS: { kind: TabKind; label: string }[] = [
  { kind: 'pick', label: 'Pick AI variant' },
  { kind: 'write', label: 'Write my own' },
  { kind: 'from-idea', label: 'From an idea' },
];

function TabBar({ active, onChange }: { active: TabKind; onChange: (k: TabKind) => void }) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 4,
        marginBottom: 20,
        background: 'var(--linen-100)',
        borderRadius: 10,
        padding: 4,
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.kind}
          role="tab"
          aria-selected={active === t.kind}
          type="button"
          onClick={() => onChange(t.kind)}
          style={{
            flex: 1,
            minHeight: 36,
            fontSize: 12,
            fontWeight: active === t.kind ? 600 : 400,
            background: active === t.kind ? 'white' : 'transparent',
            color: active === t.kind ? 'var(--navy-700)' : 'var(--ink-500)',
            border: active === t.kind ? '1px solid var(--ink-100)' : '1px solid transparent',
            borderRadius: 8,
            cursor: 'pointer',
            transition: 'var(--trans)',
            padding: '0 6px',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky bottom action bar
// ---------------------------------------------------------------------------

function AdvanceBar({ onAdvance, isPending }: { onAdvance: () => void; isPending: boolean }) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        background: 'white',
        borderTop: '1px solid var(--ink-100)',
        padding:
          'max(12px, env(safe-area-inset-bottom)) 0 max(16px, env(safe-area-inset-bottom))',
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
        {isPending ? 'Generating clip plan…' : 'Generate clip plan →'}
      </button>
      <p
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: 'var(--ink-500)',
          fontStyle: 'italic',
          margin: '8px 0 0',
        }}
      >
        Usually takes 1–2 minutes
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode: Pick AI variant (original behavior)
// ---------------------------------------------------------------------------

function PickMode({
  parshaSlug,
  scripts,
  defaultScript,
}: {
  parshaSlug: string;
  scripts: Script[];
  defaultScript: Script;
}) {
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
    <div>
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
            fontSize: 18,
            margin: 0,
            color: 'var(--ink-900)',
          }}
        >
          {selected.title ?? selected.option}
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
        style={textareaStyle}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 12px',
          marginTop: 8,
          background: 'var(--linen-50)',
          borderRadius: 8,
          fontSize: 12,
          flexWrap: 'wrap',
          gap: 4,
        }}
      >
        <span style={{ color: 'var(--ink-700)' }}>
          {fb.words} words &middot; ~{Math.round(fb.estimatedSeconds)}s &middot;{' '}
          {fb.wps.toFixed(1)} wps &middot; ~{fb.clipCountEstimate} clips
        </span>
        <span
          style={{
            color: fb.fits60s ? 'var(--jade)' : 'var(--tassel)',
            fontWeight: 500,
          }}
        >
          {isPending ? 'Saving…' : fb.fits60s ? 'fits 60s ✓' : 'over 60s ⚠'}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode: Write my own (includes inline "Polish with AI" magic button)
// ---------------------------------------------------------------------------

function WriteMode({ parshaSlug }: { parshaSlug: string }) {
  const [localText, setLocalText] = useLocalStorageDraft<string>(
    `script.${parshaSlug}.custom`,
    '',
  );

  const [polishState, setPolishState] = useState<PolishState>({
    original: '',
    polished: null,
    status: 'idle',
  });
  const [diffChanges, setDiffChanges] = useState<Change[]>([]);

  async function handlePolish() {
    const snapshot = localText;
    setPolishState({ original: snapshot, polished: null, status: 'polishing' });
    try {
      const res = await fetch('/api/script/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original: snapshot }),
      });
      const json = (await res.json()) as { polished?: string; error?: string };
      if (!res.ok || json.error) {
        toast.error('Polish failed.', { description: json.error ?? `HTTP ${res.status}` });
        setPolishState({ original: '', polished: null, status: 'idle' });
        return;
      }
      const polished = json.polished ?? snapshot;
      const changes = diffWords(snapshot, polished);
      setDiffChanges(changes);
      setPolishState({ original: snapshot, polished, status: 'reviewing' });
    } catch (e) {
      toast.error('Polish request failed.', { description: (e as Error).message });
      setPolishState({ original: '', polished: null, status: 'idle' });
    }
  }

  function handleAccept() {
    if (!polishState.polished) return;
    setLocalText(polishState.polished);
    setPolishState({ original: '', polished: null, status: 'idle' });
    setDiffChanges([]);
    toast.success('Polished version accepted.');
  }

  function handleReject() {
    setPolishState({ original: '', polished: null, status: 'idle' });
    setDiffChanges([]);
  }

  const isPolishing = polishState.status === 'polishing';
  const isReviewing = polishState.status === 'reviewing';
  const hasText = localText.trim().length > 0;

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 0, marginBottom: 12 }}>
        Write your script from scratch. It will be saved in your browser until you advance.
      </p>

      {!isReviewing ? (
        <>
          <textarea
            placeholder="Start writing your voiceover script here…"
            value={localText}
            onChange={(e) => setLocalText(e.target.value)}
            disabled={isPolishing}
            style={{ ...textareaStyle, minHeight: 280, opacity: isPolishing ? 0.6 : 1 }}
            autoFocus
          />
          <MetricsRow text={localText} />
          {hasText && (
            <button
              type="button"
              onClick={handlePolish}
              disabled={isPolishing}
              style={{
                marginTop: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
                background: isPolishing ? 'var(--linen-100)' : 'var(--linen-50)',
                color: isPolishing ? 'var(--ink-400)' : 'var(--navy-700)',
                border: '1px solid var(--ink-100)',
                borderRadius: 8,
                cursor: isPolishing ? 'wait' : 'pointer',
                transition: 'var(--trans)',
                animation: isPolishing ? 'pulse-navy 1.8s ease-in-out infinite' : 'none',
              }}
            >
              {isPolishing ? '✨ Polishing…' : '✨ Polish with AI'}
            </button>
          )}
        </>
      ) : (
        <>
          <DiffView changes={diffChanges} />
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button
              type="button"
              onClick={handleAccept}
              style={{
                flex: 1,
                minHeight: 44,
                fontSize: 14,
                fontWeight: 500,
                background: 'var(--jade)',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={handleReject}
              style={{
                flex: 1,
                minHeight: 44,
                fontSize: 14,
                fontWeight: 500,
                background: 'transparent',
                color: 'var(--tassel)',
                border: '1px solid var(--tassel)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Reject
            </button>
          </div>
          {polishState.polished && <MetricsRow text={polishState.polished} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode: From an idea (text or microphone -> AI draft)
// ---------------------------------------------------------------------------

function FromIdeaMode({ parshaSlug }: { parshaSlug: string }) {
  const [idea, setIdea] = useState('');
  const [status, setStatus] = useState<FromIdeaStatus>('idle');
  const [draftText, setDraftText] = useState('');
  const [draftTitle, setDraftTitle] = useState('');

  async function generateScript() {
    if (!idea.trim()) return;
    setStatus('generating');
    try {
      const res = await fetch('/api/script/from-idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, parshaSlug }),
      });
      const json = (await res.json()) as { draftText?: string; title?: string; error?: string };
      if (!res.ok || json.error) {
        toast.error('Script generation failed.', {
          description: json.error ?? `HTTP ${res.status}`,
        });
        setStatus('idle');
        return;
      }
      setDraftText(json.draftText ?? '');
      setDraftTitle(json.title ?? 'Draft script');
      setStatus('done');
    } catch (e) {
      toast.error('Script generation request failed.', { description: (e as Error).message });
      setStatus('idle');
    }
  }

  const isGenerating = status === 'generating';
  const isDone = status === 'done';

  return (
    <div>
      {!isDone ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 0, marginBottom: 6 }}>
            Share a thought or Torah idea and AI will draft a ~60s script.
          </p>
          <p style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 0, marginBottom: 12 }}>
            Tip: on iPhone, tap the microphone on your keyboard to dictate instead of typing.
          </p>

          <textarea
            placeholder="e.g. The idea that chesed starts from within, that we can&apos;t give what we don&apos;t have…"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            disabled={isGenerating}
            style={{ ...textareaStyle, minHeight: 140 }}
          />

          <button
            type="button"
            onClick={generateScript}
            disabled={!idea.trim() || isGenerating}
            style={{
              marginTop: 12,
              width: '100%',
              minHeight: 44,
              fontSize: 14,
              fontWeight: 500,
              background: 'var(--navy-700)',
              color: 'var(--linen-50)',
              border: 'none',
              borderRadius: 8,
              cursor: !idea.trim() || isGenerating ? 'not-allowed' : 'pointer',
              opacity: !idea.trim() || isGenerating ? 0.6 : 1,
              animation: isGenerating ? 'pulse-navy 1.8s ease-in-out infinite' : 'none',
            }}
          >
            {isGenerating ? 'Generating script…' : 'Generate script →'}
          </button>
        </>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <strong style={{ fontSize: 14, color: 'var(--ink-900)' }}>{draftTitle}</strong>
            <button
              type="button"
              onClick={() => {
                setStatus('idle');
                setDraftText('');
                setDraftTitle('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--navy-700)',
                textDecoration: 'underline',
                fontSize: 12,
                cursor: 'pointer',
                minHeight: 44,
                padding: '0 4px',
              }}
            >
              Try different idea
            </button>
          </div>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            style={{ ...textareaStyle, minHeight: 280 }}
          />
          <MetricsRow text={draftText} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline word-level diff renderer
// ---------------------------------------------------------------------------

function DiffView({ changes }: { changes: Change[] }) {
  return (
    <div
      style={{
        fontFamily: 'var(--ff-body)',
        fontSize: 16,
        lineHeight: 1.6,
        padding: 12,
        border: '1px solid var(--ink-100)',
        borderRadius: 8,
        background: 'white',
        color: 'var(--ink-900)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {changes.map((part, i) => {
        if (part.added) {
          return (
            <span
              key={i}
              style={{
                color: 'var(--jade)',
                textDecoration: 'underline',
                textDecorationColor: 'var(--jade)',
              }}
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={i}
              style={{
                color: 'var(--tassel)',
                textDecoration: 'line-through',
                opacity: 0.7,
              }}
            >
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function Phase1Script({ parshaSlug, scripts, defaultScript, onAdvance, advancing = false }: Props) {
  const [activeTab, setActiveTab] = useState<TabKind>('pick');

  return (
    <section>
      <h2
        style={{
          fontFamily: 'var(--ff-display)',
          fontSize: 22,
          margin: '0 0 16px',
          color: 'var(--ink-900)',
        }}
      >
        Edit the script
      </h2>

      <TabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === 'pick' && (
        <PickMode parshaSlug={parshaSlug} scripts={scripts} defaultScript={defaultScript} />
      )}

      {activeTab === 'write' && <WriteMode parshaSlug={parshaSlug} />}

      {activeTab === 'from-idea' && <FromIdeaMode parshaSlug={parshaSlug} />}

      <AdvanceBar onAdvance={onAdvance} isPending={advancing} />
    </section>
  );
}
