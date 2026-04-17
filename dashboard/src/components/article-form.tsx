'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArticleEditor } from './article-editor';

type Category = 'Essay' | 'Teaching' | 'Reflection';

interface ArticleFormData {
  id?: string;
  title: string;
  subtitle: string;
  slug: string;
  category: Category | '';
  excerpt: string;
  read_minutes: number | '';
  body_json: object | null;
  body_html: string;
  published: boolean;
}

function slugify(str: string) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
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

interface ArticleFormProps {
  initial?: Partial<ArticleFormData>;
}

export function ArticleForm({ initial }: ArticleFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<ArticleFormData>({
    id: initial?.id,
    title: initial?.title ?? '',
    subtitle: initial?.subtitle ?? '',
    slug: initial?.slug ?? '',
    category: initial?.category ?? '',
    excerpt: initial?.excerpt ?? '',
    read_minutes: initial?.read_minutes ?? '',
    body_json: initial?.body_json ?? null,
    body_html: initial?.body_html ?? '',
    published: initial?.published ?? false,
  });

  const [slugManuallyEdited, setSlugManuallyEdited] = useState(!!initial?.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ArticleFormData>(key: K, value: ArticleFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleTitleChange(value: string) {
    set('title', value);
    if (!slugManuallyEdited) {
      set('slug', slugify(value));
    }
  }

  const handleEditorChange = useCallback((doc: object, html: string) => {
    setForm((prev) => ({ ...prev, body_json: doc, body_html: html }));
  }, []);

  async function submit(publish: boolean) {
    setSaving(true);
    setError(null);

    const payload = {
      title: form.title,
      subtitle: form.subtitle || null,
      slug: form.slug || slugify(form.title),
      category: form.category || null,
      excerpt: form.excerpt || null,
      read_minutes: form.read_minutes !== '' ? Number(form.read_minutes) : null,
      body_json: form.body_json,
      body_html: form.body_html || null,
      published: publish,
      ...(publish && !form.published ? { published_at: new Date().toISOString() } : {}),
    };

    const url = form.id ? `/api/articles/${form.id}` : '/api/articles';
    const method = form.id ? 'PATCH' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Unknown error' }));
      setError(body.error ?? 'Failed to save.');
      return;
    }

    const saved = await res.json();
    const id = saved.id ?? form.id;
    router.push('/articles');
  }

  const isNew = !form.id;

  return (
    <div style={{ maxWidth: '760px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
        {/* Title */}
        <div>
          <label style={{ ...LABEL_STYLE }}>Title *</label>
          <input
            type="text"
            required
            placeholder="The title of the article"
            value={form.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            style={{
              ...INPUT_STYLE,
              fontFamily: 'var(--ff-display)',
              fontSize: '22px',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              fontVariationSettings: '"opsz" 36, "SOFT" 30',
              padding: '12px 14px',
            }}
          />
        </div>

        {/* Subtitle */}
        <div>
          <label style={LABEL_STYLE}>Subtitle</label>
          <input
            type="text"
            placeholder="Optional deck sentence"
            value={form.subtitle}
            onChange={(e) => set('subtitle', e.target.value)}
            style={INPUT_STYLE}
          />
        </div>

        {/* Slug */}
        <div>
          <label style={LABEL_STYLE}>Slug</label>
          <input
            type="text"
            placeholder="auto-generated-from-title"
            value={form.slug}
            onChange={(e) => {
              setSlugManuallyEdited(true);
              set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
            }}
            style={{ ...INPUT_STYLE, fontFamily: 'monospace', fontSize: '13px' }}
          />
        </div>

        {/* Category + Read minutes row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: '16px' }}>
          <div>
            <label style={LABEL_STYLE}>Category</label>
            <select
              value={form.category}
              onChange={(e) => set('category', e.target.value as Category)}
              style={{ ...INPUT_STYLE, cursor: 'pointer' }}
            >
              <option value="">— select —</option>
              <option value="Essay">Essay</option>
              <option value="Teaching">Teaching</option>
              <option value="Reflection">Reflection</option>
            </select>
          </div>
          <div>
            <label style={LABEL_STYLE}>Read minutes</label>
            <input
              type="number"
              min={1}
              max={60}
              placeholder="5"
              value={form.read_minutes}
              onChange={(e) => set('read_minutes', e.target.value === '' ? '' : Number(e.target.value))}
              style={INPUT_STYLE}
            />
          </div>
        </div>

        {/* Excerpt */}
        <div>
          <label style={LABEL_STYLE}>Excerpt</label>
          <textarea
            rows={3}
            placeholder="A short summary shown in lists and cards"
            value={form.excerpt}
            onChange={(e) => set('excerpt', e.target.value)}
            style={{ ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 }}
          />
        </div>

        {/* Body */}
        <div>
          <label style={LABEL_STYLE}>Body</label>
          <ArticleEditor
            initialContent={form.body_json ?? undefined}
            onChange={handleEditorChange}
            placeholder="Begin writing…"
          />
        </div>

        {/* Error */}
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

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            disabled={saving}
            onClick={() => submit(false)}
            style={{
              fontFamily: 'var(--ff-body)',
              fontWeight: 500,
              fontSize: '14px',
              padding: '11px 24px',
              minHeight: '44px',
              borderRadius: '999px',
              border: '1px solid var(--ink-200)',
              background: 'transparent',
              color: 'var(--ink-700)',
              cursor: saving ? 'default' : 'pointer',
              transition: 'all var(--trans)',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>

          <button
            type="button"
            disabled={saving || !form.title.trim()}
            onClick={() => submit(true)}
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
              cursor: saving || !form.title.trim() ? 'default' : 'pointer',
              transition: 'all var(--trans)',
              opacity: saving || !form.title.trim() ? 0.5 : 1,
            }}
          >
            {saving ? 'Publishing…' : form.published ? 'Save & keep published' : 'Publish'}
          </button>

          {form.published && (
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                const res = await fetch(`/api/articles/${form.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ published: false }),
                });
                setSaving(false);
                if (res.ok) {
                  set('published', false);
                }
              }}
              style={{
                fontFamily: 'var(--ff-body)',
                fontWeight: 500,
                fontSize: '13px',
                padding: '9px 18px',
                minHeight: '44px',
                borderRadius: '999px',
                border: '1px solid var(--tassel)',
                background: 'transparent',
                color: 'var(--tassel)',
                cursor: saving ? 'default' : 'pointer',
                transition: 'all var(--trans)',
                opacity: saving ? 0.6 : 1,
                marginLeft: 'auto',
              }}
            >
              Unpublish
            </button>
          )}

          <button
            type="button"
            onClick={() => router.push('/articles')}
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '13px',
              padding: '9px 14px',
              minHeight: '44px',
              border: 'none',
              background: 'transparent',
              color: 'var(--ink-400)',
              cursor: 'pointer',
              fontVariationSettings: '"opsz" 14, "SOFT" 50',
              marginLeft: form.published ? undefined : 'auto',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
