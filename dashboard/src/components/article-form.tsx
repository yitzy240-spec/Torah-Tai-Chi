'use client';

import { useState, useEffect, useCallback } from 'react';
import { wordsToReadMinutes } from '@/lib/read-time';
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
  seo_title: string;
  seo_description: string;
  seo_og_image: string;
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

const SEO_SECTION_STYLE: React.CSSProperties = {
  border: '1px solid var(--ink-100)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const SEO_HINT_STYLE: React.CSSProperties = {
  marginTop: '5px',
  fontSize: '12px',
  lineHeight: 1.45,
  color: 'var(--ink-400)',
  fontFamily: 'var(--ff-body)',
};

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
    seo_title: initial?.seo_title ?? '',
    seo_description: initial?.seo_description ?? '',
    seo_og_image: initial?.seo_og_image ?? '',
  });
  const [seoOpen, setSeoOpen] = useState(false);

  const [slugManuallyEdited, setSlugManuallyEdited] = useState(!!initial?.slug);
  // Which action is in flight, so only the clicked button shows a loading
  // label (Save draft no longer makes Publish look like it triggered).
  const [words, setWords] = useState(0);
  const [autosaveAt, setAutosaveAt] = useState<number | null>(null);
  const [savingAction, setSavingAction] = useState<null | 'draft' | 'preview' | 'publish' | 'unpublish'>(null);
  const saving = savingAction !== null;
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when a publish completes successfully — drives the
  // "Public site updating…" confirmation banner. The API route
  // already kicked off ISR revalidation before returning, so the
  // public site is refreshing while this banner is on screen.
  const [lastPublished, setLastPublished] = useState<number | null>(null);

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

  // Autosave drafts only: requires an existing story (form.id) and a DRAFT
  // (!form.published) so it never creates junk and never pushes live changes.
  // Debounced 2s after the last edit; skipped while a manual save is running.
  useEffect(() => {
    if (!form.id || form.published || savingAction) return;
    const handle = setTimeout(async () => {
      const res = await fetch(`/api/articles/${form.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title, subtitle: form.subtitle || null, slug: form.slug || undefined,
          category: form.category || null, excerpt: form.excerpt || null,
          read_minutes: wordsToReadMinutes(words), body_json: form.body_json, body_html: form.body_html || null,
          // Deliberately omit `published`: autosave must never change publish
          // state. updateArticle preserves the story's current state when the
          // field is absent (the effect is already gated to drafts only).
          seo_title: form.seo_title || null, seo_description: form.seo_description || null, seo_og_image: form.seo_og_image || null,
          _autosave: true,
        }),
      });
      if (res.ok) setAutosaveAt(Date.now());
    }, 2000);
    return () => clearTimeout(handle);
  }, [form.id, form.published, form.title, form.subtitle, form.slug, form.category, form.excerpt, form.body_json, form.body_html, form.seo_title, form.seo_description, form.seo_og_image, words, savingAction]);

  // Core save. Returns the API result (incl. previewUrl) or null on failure.
  // Does NOT navigate — each action handler decides what happens next.
  async function save(publish: boolean): Promise<{ id: string; slug: string; previewUrl: string | null } | null> {
    setError(null);
    setSavedAt(null);

    const payload = {
      title: form.title,
      subtitle: form.subtitle || null,
      slug: form.slug || slugify(form.title),
      category: form.category || null,
      excerpt: form.excerpt || null,
      read_minutes: wordsToReadMinutes(words),
      body_json: form.body_json,
      body_html: form.body_html || null,
      published: publish,
      ...(publish && !form.published ? { published_at: new Date().toISOString() } : {}),
      seo_title: form.seo_title || null,
      seo_description: form.seo_description || null,
      seo_og_image: form.seo_og_image || null,
    };

    const url = form.id ? `/api/articles/${form.id}` : '/api/articles';
    const method = form.id ? 'PATCH' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Unknown error' }));
      setError(body.error ?? 'Failed to save.');
      return null;
    }

    const data = await res.json();
    // Switch to edit mode immediately so a second action PATCHes the same
    // story instead of POSTing a duplicate.
    if (!form.id && data.id) set('id', String(data.id));
    return data;
  }

  async function handleSaveDraft() {
    const wasNew = !form.id;
    setSavingAction('draft');
    const data = await save(false);
    setSavingAction(null);
    if (!data) return;
    // Stay in the editor (don't bounce to the list) so Preview is right there.
    // A brand-new article moves to its edit URL so it's now a real saved draft.
    if (wasNew) router.replace(`/articles/${data.id}/edit`);
    else setSavedAt(Date.now());
  }

  function handlePreview() {
    // Open the tab synchronously inside the click so it isn't popup-blocked;
    // redirect it to the preview once the draft is saved.
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    const wasNew = !form.id;
    setSavingAction('preview');
    save(false)
      .then((data) => {
        setSavingAction(null);
        if (!data) {
          tab?.close();
          return;
        }
        if (data.previewUrl) {
          if (tab) tab.location.href = data.previewUrl;
        } else {
          tab?.close();
          setError('Preview is unavailable — the website URL isn’t configured.');
        }
        if (wasNew) router.replace(`/articles/${data.id}/edit`);
      })
      .catch(() => {
        setSavingAction(null);
        tab?.close();
        setError('Failed to open preview.');
      });
  }

  async function handlePublish() {
    setSavingAction('publish');
    const data = await save(true);
    setSavingAction(null);
    if (!data) return;
    // The API route already kicked off website revalidation; show a brief
    // confirmation banner, then go to the list.
    setLastPublished(Date.now());
    setTimeout(() => router.push('/articles'), 1500);
  }

  const isNew = !form.id;

  return (
    <div style={{ maxWidth: '760px' }}>
      {lastPublished && (
        <div
          role="status"
          style={{
            background: 'var(--linen-100)',
            border: '1px solid var(--ink-200)',
            borderRadius: 'var(--r-md)',
            padding: '12px 16px',
            marginBottom: '18px',
            fontFamily: 'var(--ff-body)',
            fontSize: '14px',
            color: 'var(--ink-800)',
            lineHeight: 1.5,
          }}
        >
          <strong style={{ fontWeight: 600 }}>✓ Saved.</strong>{' '}
          Public site is refreshing now — usually live within 5-10 seconds.
        </div>
      )}
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

        {/* Category */}
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
            onWordCount={(w) => setWords(w)}
            placeholder="Begin writing…"
          />
          <p style={{ fontFamily: 'var(--ff-body)', fontSize: '12px', color: 'var(--ink-400)', marginTop: '6px' }}>
            ~{wordsToReadMinutes(words)} min read (auto)
          </p>
        </div>

        {/* SEO Settings (collapsible) */}
        <div style={SEO_SECTION_STYLE}>
          <button
            type="button"
            onClick={() => setSeoOpen((v) => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--ff-body)',
              fontWeight: 600,
              fontSize: '11px',
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: 'var(--ink-500)',
            }}
          >
            SEO settings
            <span style={{ fontSize: '16px', color: 'var(--ink-400)', lineHeight: 1 }}>
              {seoOpen ? '−' : '+'}
            </span>
          </button>

          {seoOpen && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
                padding: '4px 18px 18px',
                borderTop: '1px solid var(--ink-100)',
              }}
            >
              <div>
                <label style={LABEL_STYLE}>SEO title override</label>
                <input
                  type="text"
                  placeholder={form.title || 'Defaults to article title'}
                  value={form.seo_title}
                  onChange={(e) => set('seo_title', e.target.value)}
                  style={INPUT_STYLE}
                />
                <p style={SEO_HINT_STYLE}>
                  Optional. Leave blank to use the article title{form.title ? `: "${form.title}"` : ''}.
                </p>
              </div>
              <div>
                <label style={LABEL_STYLE}>SEO description override</label>
                <textarea
                  rows={3}
                  placeholder={form.excerpt || 'Defaults to excerpt'}
                  value={form.seo_description}
                  onChange={(e) => set('seo_description', e.target.value)}
                  style={{ ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.55 }}
                />
                <p style={SEO_HINT_STYLE}>
                  Optional. Leave blank to use the excerpt{form.excerpt ? `: "${form.excerpt.slice(0, 80)}${form.excerpt.length > 80 ? '…' : ''}"` : ''}.
                </p>
              </div>
              <div>
                <label style={LABEL_STYLE}>SEO OG image URL override</label>
                <input
                  type="url"
                  placeholder="https://…"
                  value={form.seo_og_image}
                  onChange={(e) => set('seo_og_image', e.target.value)}
                  style={{ ...INPUT_STYLE, fontFamily: 'monospace', fontSize: '13px' }}
                />
                {form.seo_og_image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.seo_og_image}
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
                <p style={SEO_HINT_STYLE}>
                  Optional. Leave blank to use an automatically generated share image for this article.
                </p>
              </div>
            </div>
          )}
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

        {/* Actions — the natural flow reads left→right: Save draft (quiet) →
            Preview (prominent next step) → Publish (the final "go live"). */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveDraft}
            title="Save your progress without publishing"
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
            {savingAction === 'draft' ? 'Saving…' : 'Save draft'}
          </button>

          {savedAt && (
            <span
              role="status"
              style={{
                fontFamily: 'var(--ff-display)',
                fontStyle: 'italic',
                fontSize: '13px',
                color: 'var(--jade)',
                fontVariationSettings: '"opsz" 14, "SOFT" 50',
              }}
            >
              Saved ✓
            </span>
          )}

          {autosaveAt && !savingAction && (
            <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12px', color: 'var(--ink-400)' }}>Draft autosaved</span>
          )}

          <button
            type="button"
            disabled={saving || !form.title.trim()}
            onClick={handlePreview}
            title="Save and see how it will look on the live site"
            style={{
              fontFamily: 'var(--ff-body)',
              fontWeight: 600,
              fontSize: '14px',
              padding: '11px 26px',
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
            {savingAction === 'preview' ? 'Opening…' : 'Preview ↗'}
          </button>

          <button
            type="button"
            disabled={saving || !form.title.trim()}
            onClick={handlePublish}
            title="Make this article live on the public site"
            style={{
              fontFamily: 'var(--ff-body)',
              fontWeight: 600,
              fontSize: '14px',
              padding: '11px 26px',
              minHeight: '44px',
              borderRadius: '999px',
              border: 'none',
              background: 'var(--jade)',
              color: 'var(--linen-50)',
              cursor: saving || !form.title.trim() ? 'default' : 'pointer',
              transition: 'all var(--trans)',
              opacity: saving || !form.title.trim() ? 0.5 : 1,
            }}
          >
            {savingAction === 'publish' ? 'Publishing…' : form.published ? 'Save & keep published' : 'Publish'}
          </button>

          {form.published && (
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                setSavingAction('unpublish');
                const res = await fetch(`/api/articles/${form.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ published: false }),
                });
                setSavingAction(null);
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
              {savingAction === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
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
