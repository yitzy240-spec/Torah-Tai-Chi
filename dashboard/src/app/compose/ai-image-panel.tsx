'use client';

import { useEffect, useRef, useState } from 'react';

type Reference =
  | { kind: 'none' }
  | { kind: 'rav-eli' }
  | { kind: 'logo' }
  | { kind: 'custom'; url: string };

interface Props {
  onSelect: (url: string) => void;
  onCancel: () => void;
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--ff-body)',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-500)',
  marginBottom: '8px',
};

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  fontFamily: 'var(--ff-body)',
  fontSize: '14.5px',
  color: 'var(--ink-900)',
  background: 'var(--linen-50)',
  border: '1px solid var(--ink-200)',
  borderRadius: 'var(--r-md)',
  outline: 'none',
  boxSizing: 'border-box',
};

const REFERENCE_CHOICES: { kind: 'none' | 'rav-eli' | 'logo' | 'custom'; label: string }[] = [
  { kind: 'none',    label: 'No reference' },
  { kind: 'rav-eli', label: 'Rav Eli' },
  { kind: 'logo',    label: 'Logo' },
  { kind: 'custom',  label: 'Upload…' },
];

export function AiImagePanel({ onSelect, onCancel }: Props) {
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<'1:1' | '9:16' | '16:9'>('1:1');
  const [reference, setReference] = useState<Reference>({ kind: 'none' });
  const [customUploading, setCustomUploading] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  const uploadCustomRef = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCustomUploading(true);
    setError(null);
    try {
      const signRes = await fetch('/api/compose/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      const signText = await signRes.text();
      let signJson: { signedUrl?: string; publicUrl?: string; error?: string };
      try { signJson = JSON.parse(signText); } catch { throw new Error(`Sign failed: ${signText.slice(0, 120)}`); }
      if (!signRes.ok || !signJson.signedUrl || !signJson.publicUrl) {
        throw new Error(signJson.error ?? `Sign failed (${signRes.status})`);
      }
      const putRes = await fetch(signJson.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      setReference({ kind: 'custom', url: signJson.publicUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomUploading(false);
    }
  };

  const startGeneration = async (isRegenerate: boolean) => {
    if (!prompt.trim()) return;
    setError(null);
    setGenerating(true);
    setResultUrl(null);

    try {
      const refPayload: { kind: string; url?: string } =
        reference.kind === 'custom'
          ? { kind: 'custom' as const, url: reference.url }
          : { kind: reference.kind as string };

      const res = await fetch('/api/compose/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: prompt,
          reference: refPayload,
          aspectRatio: aspect,
          ...(isRegenerate && feedback ? { feedback } : {}),
          ...(isRegenerate && expandedPrompt ? { previousPrompt: expandedPrompt } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Start failed (${res.status})`);
      setTaskId(data.taskId);
      setExpandedPrompt(data.expandedPrompt);
      setFeedback('');

      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = setInterval(async () => {
        try {
          const pRes = await fetch(`/api/compose/generate-image?taskId=${encodeURIComponent(data.taskId)}`, { cache: 'no-store' });
          const pData = await pRes.json();
          if (!pRes.ok) throw new Error(pData.error ?? `Poll failed (${pRes.status})`);
          if (pData.state === 'success') {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setResultUrl(pData.url);
            setGenerating(false);
          } else if (pData.state === 'failed') {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setError(pData.error ?? 'Generation failed');
            setGenerating(false);
          }
        } catch (err) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setError(err instanceof Error ? err.message : String(err));
          setGenerating(false);
        }
      }, 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGenerating(false);
    }
  };

  const useResult = () => {
    if (resultUrl) {
      onSelect(resultUrl);
    }
  };

  return (
    <div
      style={{
        padding: '22px 24px',
        border: '1px solid var(--ink-100)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--linen-50)',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '17px', color: 'var(--ink-900)', fontVariationSettings: '"opsz" 18, "SOFT" 30' }}>
            Generate image with AI
          </div>
          <div style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12.5px', color: 'var(--ink-500)', marginTop: '2px', fontVariationSettings: '"opsz" 14, "SOFT" 50' }}>
            Claude expands the brief, Kie.ai renders. ~30–60s per image.
          </div>
        </div>
        <button type="button" onClick={onCancel} style={CANCEL_LINK_STYLE}>Close</button>
      </div>

      {/* Prompt */}
      <div>
        <label htmlFor="ai-img-prompt" style={LABEL_STYLE}>What should the image show?</label>
        <textarea
          id="ai-img-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. a warm announcement graphic with cedar + linen tones introducing the new weekly video series"
          rows={3}
          style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: '80px', lineHeight: 1.5 }}
          disabled={generating}
        />
      </div>

      {/* Reference + Aspect */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '18px', alignItems: 'start' }} className="ai-img-row">
        <div>
          <label style={LABEL_STYLE}>Reference</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {REFERENCE_CHOICES.map((c) => {
              const active = reference.kind === c.kind;
              if (c.kind === 'custom') {
                return (
                  <label key={c.kind} style={{ ...CHIP_STYLE, ...(active ? CHIP_ACTIVE : {}), opacity: customUploading ? 0.6 : 1 }}>
                    <input type="file" accept="image/*" disabled={customUploading || generating} onChange={uploadCustomRef} style={{ display: 'none' }} />
                    {customUploading ? 'Uploading…' : reference.kind === 'custom' ? 'Custom ✓' : c.label}
                  </label>
                );
              }
              const simpleKind = c.kind as 'none' | 'rav-eli' | 'logo';
              return (
                <button
                  key={c.kind}
                  type="button"
                  disabled={generating}
                  onClick={() => setReference({ kind: simpleKind })}
                  style={{ ...CHIP_STYLE, ...(active ? CHIP_ACTIVE : {}) }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label style={LABEL_STYLE}>Aspect</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['1:1', '9:16', '16:9'] as const).map((a) => {
              const active = aspect === a;
              return (
                <button
                  key={a}
                  type="button"
                  disabled={generating}
                  onClick={() => setAspect(a)}
                  style={{ ...CHIP_STYLE, ...(active ? CHIP_ACTIVE : {}) }}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Generate */}
      {!resultUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={() => startGeneration(false)}
            disabled={!prompt.trim() || generating}
            style={{ ...CTA_STYLE, opacity: !prompt.trim() || generating ? 0.5 : 1, cursor: !prompt.trim() || generating ? 'not-allowed' : 'pointer' }}
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
          {generating && <Spinner />}
        </div>
      )}

      {/* Result */}
      {resultUrl && !generating && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resultUrl}
            alt="Generated"
            style={{
              maxWidth: '100%',
              maxHeight: '360px',
              width: 'auto',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--ink-100)',
              display: 'block',
            }}
          />
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" onClick={useResult} style={CTA_STYLE}>Use this image</button>
            <button type="button" onClick={() => { setResultUrl(null); setFeedback(''); }} style={GHOST_STYLE}>Try a different angle</button>
          </div>

          <div>
            <label htmlFor="ai-img-feedback" style={LABEL_STYLE}>Regenerate with feedback</label>
            <textarea
              id="ai-img-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. warmer lighting, move the logo to upper-left, less negative space"
              rows={2}
              style={{ ...INPUT_STYLE, resize: 'vertical', minHeight: '60px', lineHeight: 1.5 }}
            />
            <button
              type="button"
              onClick={() => startGeneration(true)}
              disabled={!feedback.trim() || generating}
              style={{ ...GHOST_STYLE, marginTop: '10px', opacity: !feedback.trim() ? 0.5 : 1 }}
            >
              Regenerate with feedback
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(192,57,43,.08)', border: '1px solid rgba(192,57,43,.2)', fontFamily: 'var(--ff-body)', fontSize: '12.5px', color: '#8b2d1c' }}>
          {error}
        </div>
      )}

      {expandedPrompt && (
        <details style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12px', color: 'var(--ink-400)' }}>
          <summary style={{ cursor: 'pointer' }}>See expanded prompt</summary>
          <div style={{ marginTop: '6px', padding: '10px 12px', background: 'var(--ink-100)', borderRadius: 'var(--r-sm)', color: 'var(--ink-700)', fontStyle: 'normal', fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {expandedPrompt}
          </div>
        </details>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        border: '2px solid var(--ink-100)',
        borderTopColor: 'var(--navy-800)',
        display: 'inline-block',
        animation: 'tt-spin 0.9s linear infinite',
      }}
    />
  );
}

const CHIP_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-body)',
  fontSize: '12.5px',
  fontWeight: 500,
  padding: '7px 14px',
  minHeight: '34px',
  borderRadius: '999px',
  border: '1px solid var(--ink-200)',
  background: 'transparent',
  color: 'var(--ink-700)',
  cursor: 'pointer',
  transition: 'all var(--trans)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
};

const CHIP_ACTIVE: React.CSSProperties = {
  borderColor: 'var(--navy-800)',
  background: 'var(--navy-800)',
  color: 'var(--linen-50)',
};

const CTA_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-body)',
  fontWeight: 500,
  fontSize: '13.5px',
  padding: '10px 20px',
  minHeight: '40px',
  borderRadius: '999px',
  border: '1px solid var(--navy-800)',
  background: 'var(--navy-800)',
  color: 'var(--linen-50)',
  cursor: 'pointer',
  transition: 'all var(--trans)',
};

const GHOST_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-body)',
  fontWeight: 500,
  fontSize: '13.5px',
  padding: '10px 20px',
  minHeight: '40px',
  borderRadius: '999px',
  border: '1px solid var(--ink-200)',
  background: 'transparent',
  color: 'var(--ink-700)',
  cursor: 'pointer',
  transition: 'all var(--trans)',
};

const CANCEL_LINK_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ff-body)',
  fontSize: '12.5px',
  color: 'var(--ink-500)',
  textDecoration: 'underline',
  textDecorationColor: 'var(--ink-200)',
  background: 'none',
  border: 'none',
  padding: '4px 8px',
  cursor: 'pointer',
};
