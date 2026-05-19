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
import { useState, useRef, useCallback } from 'react';
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

type TabKind = 'pick' | 'write' | 'from-idea' | 'polish';

type FromIdeaStatus = 'idle' | 'recording' | 'transcribing' | 'generating' | 'done';
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
  { kind: 'polish', label: 'AI polish' },
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
        Next: review clip plan &rarr;
      </button>
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
// Mode: Write my own
// ---------------------------------------------------------------------------

function WriteMode({ parshaSlug }: { parshaSlug: string }) {
  const [localText, setLocalText] = useLocalStorageDraft<string>(
    `script.${parshaSlug}.custom`,
    '',
  );

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 0, marginBottom: 12 }}>
        Write your script from scratch. It will be saved in your browser until you advance.
      </p>
      <textarea
        placeholder="Start writing your voiceover script here…"
        value={localText}
        onChange={(e) => setLocalText(e.target.value)}
        style={{ ...textareaStyle, minHeight: 280 }}
        autoFocus
      />
      <MetricsRow text={localText} />
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
  const [micSupported, setMicSupported] = useState<boolean | null>(null); // null = unknown
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Detect mic support on first render (client only)
  const checkMicSupport = useCallback(() => {
    if (micSupported !== null) return;
    if (
      typeof window === 'undefined' ||
      !navigator?.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setMicSupported(false);
    } else {
      setMicSupported(true);
    }
  }, [micSupported]);

  // Call once to set the support flag
  if (micSupported === null && typeof window !== 'undefined') {
    checkMicSupport();
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await transcribeBlob(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setStatus('recording');
    } catch (e) {
      // Permission denied or hardware unavailable — degrade gracefully
      setMicSupported(false);
      toast.error('Microphone not available. Type your idea instead.', {
        description: (e as Error).message,
      });
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setStatus('transcribing');
    }
  }

  async function transcribeBlob(blob: Blob) {
    setStatus('transcribing');
    const form = new FormData();
    form.append('audio', blob, 'recording.webm');
    try {
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const json = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || json.error) {
        toast.error('Transcription failed.', { description: json.error ?? `HTTP ${res.status}` });
        setStatus('idle');
        return;
      }
      setIdea(json.text ?? '');
      setStatus('idle');
    } catch (e) {
      toast.error('Transcription request failed.', { description: (e as Error).message });
      setStatus('idle');
    }
  }

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
  const isTranscribing = status === 'transcribing';
  const isRecording = status === 'recording';
  const isDone = status === 'done';

  return (
    <div>
      {!isDone ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 0, marginBottom: 12 }}>
            Share a thought or Torah idea and AI will draft a ~60s script.
          </p>

          <div style={{ position: 'relative' }}>
            <textarea
              placeholder="e.g. The idea that chesed starts from within, that we can&apos;t give what we don&apos;t have…"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              disabled={isGenerating || isTranscribing || isRecording}
              style={{
                ...textareaStyle,
                minHeight: 140,
                paddingRight: micSupported ? 52 : 12,
              }}
            />
            {/* Microphone button — only shown if browser supports MediaRecorder */}
            {micSupported && (
              <button
                type="button"
                aria-label={isRecording ? 'Stop recording' : 'Record idea with microphone'}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isGenerating || isTranscribing}
                style={{
                  position: 'absolute',
                  right: 10,
                  bottom: 10,
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  border: 'none',
                  background: isRecording ? 'var(--tassel)' : 'var(--navy-700)',
                  color: 'white',
                  fontSize: 18,
                  cursor: isGenerating || isTranscribing ? 'not-allowed' : 'pointer',
                  opacity: isGenerating || isTranscribing ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  animation: isRecording ? 'pulse-navy 1.8s ease-in-out infinite' : 'none',
                }}
              >
                {isRecording ? '⏹' : '\u{1F3A4}'}
              </button>
            )}
          </div>

          {isTranscribing && (
            <p
              style={{
                fontSize: 13,
                color: 'var(--ink-500)',
                marginTop: 8,
                animation: 'pulse-navy 1.8s ease-in-out infinite',
              }}
            >
              Transcribing recording…
            </p>
          )}

          <button
            type="button"
            onClick={generateScript}
            disabled={!idea.trim() || isGenerating || isTranscribing || isRecording}
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
              cursor:
                !idea.trim() || isGenerating || isTranscribing || isRecording
                  ? 'not-allowed'
                  : 'pointer',
              opacity: !idea.trim() || isGenerating || isTranscribing || isRecording ? 0.6 : 1,
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
// Mode: AI Polish
// ---------------------------------------------------------------------------

function PolishMode({
  parshaSlug,
  scripts,
  defaultScript,
}: {
  parshaSlug: string;
  scripts: Script[];
  defaultScript: Script;
}) {
  // Reuse the same selected script state as PickMode for this session
  const [selectedId] = useState<string>(defaultScript.id);
  const selected = scripts.find((s) => s.id === selectedId) ?? defaultScript;

  const [localText, setLocalText, clearDraft] = useLocalStorageDraft(
    `script.${parshaSlug}.${selected.id}`,
    selected.draft_text ?? '',
  );

  const { update, isPending: isSaving } = useOptimisticSave<string>({
    current: localText,
    save: async (next) => {
      await saveScript(selected.id, next);
    },
    onSuccess: clearDraft,
    errorMessage: 'Saving the script failed.',
  });

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
    update(polishState.polished);
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

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 0, marginBottom: 12 }}>
        Edit your script then send it to AI for a polish. Review the diff and accept or reject.
      </p>

      {!isReviewing ? (
        <>
          <textarea
            value={localText}
            onChange={(e) => {
              setLocalText(e.target.value);
              update(e.target.value);
            }}
            disabled={isPolishing}
            style={{ ...textareaStyle, opacity: isPolishing ? 0.6 : 1 }}
          />
          <MetricsRow text={localText} />
          <button
            type="button"
            onClick={handlePolish}
            disabled={isPolishing || !localText.trim() || isSaving}
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
              cursor: isPolishing || !localText.trim() || isSaving ? 'not-allowed' : 'pointer',
              opacity: isPolishing || !localText.trim() || isSaving ? 0.6 : 1,
              animation: isPolishing ? 'pulse-navy 1.8s ease-in-out infinite' : 'none',
            }}
          >
            {isPolishing ? 'Polishing…' : 'Polish with AI'}
          </button>
        </>
      ) : (
        <>
          <DiffView changes={diffChanges} />
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 12,
            }}
          >
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
          {polishState.polished && (
            <MetricsRow text={polishState.polished} />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function Phase1Script({ parshaSlug, scripts, defaultScript, onAdvance }: Props) {
  const [activeTab, setActiveTab] = useState<TabKind>('pick');

  // Determine if we can advance (always allowed — the connected wrapper
  // decides the actual action based on what script is in the DB)
  const canAdvance = true;

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

      {activeTab === 'polish' && (
        <PolishMode parshaSlug={parshaSlug} scripts={scripts} defaultScript={defaultScript} />
      )}

      <AdvanceBar onAdvance={onAdvance} isPending={!canAdvance} />
    </section>
  );
}
