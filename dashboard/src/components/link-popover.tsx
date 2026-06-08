'use client';
import { useEffect, useRef, useState } from 'react';

function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v) || v.startsWith('/') || v.startsWith('mailto:')) return v;
  return `https://${v}`;
}

export function LinkPopover({
  initialUrl,
  hasLink,
  onApply,
  onRemove,
  onClose,
}: {
  initialUrl: string;
  hasLink: boolean;
  onApply: (url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function apply() {
    const norm = normalizeUrl(url);
    if (!norm) { onRemove(); return; }
    onApply(norm);
  }

  return (
    <div
      style={{
        position: 'absolute', zIndex: 20, marginTop: '6px',
        display: 'flex', alignItems: 'center', gap: '6px',
        background: 'white', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)',
        padding: '6px 8px', boxShadow: '0 6px 24px rgba(0,0,0,.12)',
      }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <input
        ref={inputRef}
        type="url"
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
        style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', border: '1px solid var(--ink-100)', borderRadius: '4px', padding: '5px 8px', width: '220px', outline: 'none' }}
      />
      <button type="button" onClick={apply} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--navy-700)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>Apply</button>
      {hasLink && (
        <button type="button" onClick={onRemove} style={{ fontSize: '12px', color: 'var(--tassel)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>Remove</button>
      )}
    </div>
  );
}
