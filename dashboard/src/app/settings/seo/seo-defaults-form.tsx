'use client';

import { useState } from 'react';

interface SeoDefaultsData {
  site_default_title: string;
  site_default_description: string;
  site_default_og_image: string;
  twitter_handle: string;
}

interface Props {
  initial: SeoDefaultsData;
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  fontFamily: 'var(--ff-body)',
  fontSize: '15px',
  lineHeight: 1.5,
  color: 'var(--ink-900)',
  background: 'white',
  border: '1px solid var(--ink-200)',
  borderRadius: 'var(--r-md)',
  padding: '11px 14px',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color var(--trans)',
  minHeight: '44px',
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--ff-body)',
  fontWeight: 600,
  fontSize: '11px',
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'var(--ink-500)',
  marginBottom: '6px',
};

export function SeoDefaultsForm({ initial }: Props) {
  const [form, setForm] = useState<SeoDefaultsData>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof SeoDefaultsData>(key: K, value: SeoDefaultsData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/seo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Save failed');
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <label style={LABEL_STYLE}>Default site title</label>
        <input
          type="text"
          placeholder="Torah Tai Chi"
          value={form.site_default_title}
          onChange={(e) => set('site_default_title', e.target.value)}
          style={INPUT_STYLE}
        />
      </div>
      <div>
        <label style={LABEL_STYLE}>Default site description</label>
        <textarea
          rows={3}
          placeholder="Weekly teachings fusing Torah wisdom with tai chi philosophy."
          value={form.site_default_description}
          onChange={(e) => set('site_default_description', e.target.value)}
          style={{ ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 }}
        />
      </div>
      <div>
        <label style={LABEL_STYLE}>Default OG image URL</label>
        <input
          type="url"
          placeholder="https://torahtaichi.com/og/default.png"
          value={form.site_default_og_image}
          onChange={(e) => set('site_default_og_image', e.target.value)}
          style={{ ...INPUT_STYLE, fontFamily: 'monospace', fontSize: '13px' }}
        />
        {form.site_default_og_image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={form.site_default_og_image}
            alt="OG image preview"
            style={{
              marginTop: '8px',
              width: '100%',
              maxWidth: '320px',
              height: 'auto',
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--ink-100)',
            }}
          />
        )}
      </div>
      <div>
        <label style={LABEL_STYLE}>Twitter handle</label>
        <input
          type="text"
          placeholder="@torahtaichi"
          value={form.twitter_handle}
          onChange={(e) => set('twitter_handle', e.target.value)}
          style={{ ...INPUT_STYLE, fontFamily: 'monospace', fontSize: '13px' }}
        />
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--r-md)',
            background: 'rgba(178,58,43,.08)',
            color: 'var(--tassel)',
            fontFamily: 'var(--ff-display)',
            fontStyle: 'italic',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          style={{
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '14px',
            padding: '11px 28px',
            minHeight: '44px',
            borderRadius: '999px',
            border: 'none',
            background: 'var(--navy-800)',
            color: 'var(--linen-50)',
            cursor: saving ? 'default' : 'pointer',
            transition: 'all var(--trans)',
            opacity: saving ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save defaults'}
        </button>
        {saved && (
          <span
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '13px',
              color: 'var(--jade)',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
            }}
          >
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}
