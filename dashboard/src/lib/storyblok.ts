/**
 * Storyblok Management API client for the dashboard.
 * NEVER import this in client-side code — Management Token is server-only.
 */

const SPACE_ID = process.env.STORYBLOK_SPACE_ID!;
const MGMT_TOKEN = process.env.STORYBLOK_MANAGEMENT_TOKEN!;
const PREVIEW_TOKEN = process.env.STORYBLOK_PREVIEW_TOKEN!;
const BASE = `https://mapi.storyblok.com/v1/spaces/${SPACE_ID}`;
const CDN_BASE = 'https://api.storyblok.com/v2/cdn';

const ARTICLES_FOLDER = 'articles';
const SITE_TEXT_FOLDER = 'site-text';
const BOOK_FOLDER = 'book-folder';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SbArticleContent {
  component: 'article';
  title: string;
  subtitle?: string;
  category?: string;
  excerpt?: string;
  body?: object;
  published_at?: string;
  read_minutes?: number;
  seo_title?: string;
  seo_description?: string;
  seo_og_image?: string;
}

export interface SbArticleStory {
  id: number;
  uuid: string;
  name: string;
  slug: string;
  full_slug: string;
  published: boolean;
  content: SbArticleContent;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface SbSiteTextContent {
  component: 'site_text';
  key: string;
  value: string;
  description?: string;
}

export interface SbSiteTextStory {
  id: number;
  slug: string;
  content: SbSiteTextContent;
  updated_at: string;
}

export interface SbBookContent {
  component: 'book';
  visible?: boolean;
  title?: string;
  subtitle?: string;
  description?: string;
  cover_url?: string;
  purchase_url?: string;
  cta_label?: string;
  seo_title?: string;
  seo_description?: string;
  seo_og_image?: string;
}

export interface SbSeoDefaultsContent {
  component: 'seo_defaults';
  site_default_title?: string;
  site_default_description?: string;
  site_default_og_image?: string;
  twitter_handle?: string;
}

export interface SbSeoDefaultsStory {
  id: number;
  content: SbSeoDefaultsContent;
}

export interface SbBookStory {
  id: number;
  content: SbBookContent;
}

// ─────────────────────────────────────────────
// Retry helper
// ─────────────────────────────────────────────

const RETRY_DELAYS = [200, 1000]; // ms between attempts after first failure

async function retryableFetch(
  input: string,
  init?: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(input, init);
      // Retry on 5xx or network-level errors
      if (res.status >= 500 && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[i] ?? 1000));
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[i] ?? 1000));
      }
    }
  }
  throw lastError ?? new Error('retryableFetch exhausted attempts');
}

// ─────────────────────────────────────────────
// Core fetch helpers
// ─────────────────────────────────────────────

async function mapi(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: object,
): Promise<Response> {
  return retryableFetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: MGMT_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
}

async function mapiGet(path: string, params?: Record<string, string>) {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await retryableFetch(url.toString(), {
    headers: { Authorization: MGMT_TOKEN },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Storyblok GET ${path} → ${res.status}`);
  return res.json();
}

/**
 * CDN-API read. The Management API list endpoint doesn't return the `content`
 * field, so we use the CDN (preview token, draft version) for reads.
 */
async function cdnGet(path: string, params?: Record<string, string>) {
  const url = new URL(`${CDN_BASE}${path}`);
  url.searchParams.set('token', PREVIEW_TOKEN);
  url.searchParams.set('version', 'draft');
  url.searchParams.set('cv', String(Date.now()));
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await retryableFetch(url.toString(), { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storyblok CDN GET ${path} → ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────
// Folder ID cache (lazy)
// ─────────────────────────────────────────────

const _folderIdCache: Record<string, number> = {};

async function getFolderId(slug: string): Promise<number> {
  if (_folderIdCache[slug]) return _folderIdCache[slug];
  const data = await mapiGet('/stories/', { starts_with: slug, is_folder: '1', per_page: '25' });
  for (const s of data.stories ?? []) {
    if (s.slug === slug) {
      _folderIdCache[slug] = s.id;
      return s.id;
    }
  }
  throw new Error(`Storyblok folder not found: ${slug}`);
}

// ─────────────────────────────────────────────
// Story lookup helpers
// ─────────────────────────────────────────────

/**
 * Look up a story by full slug. Uses the CDN API to find the id (the mapi
 * list endpoint omits `content`), then hydrates via the mapi single-story
 * endpoint so write-paths get the exact shape mapi PUT expects.
 */
async function getStoryBySlug(fullSlug: string) {
  const cdnData = await cdnGet(`/stories/${fullSlug}`);
  const id = cdnData?.story?.id;
  if (!id) return null;
  const mapiData = await mapiGet(`/stories/${id}`);
  return mapiData?.story ?? null;
}

// ─────────────────────────────────────────────
// Articles
// ─────────────────────────────────────────────

export async function listArticles(): Promise<SbArticleStory[]> {
  const data = await cdnGet('/stories', {
    starts_with: ARTICLES_FOLDER + '/',
    per_page: '100',
    sort_by: 'content.published_at:desc',
  });
  return (data?.stories ?? []).filter(
    (s: SbArticleStory) => s.content?.component === 'article',
  );
}

export async function getArticle(slug: string): Promise<SbArticleStory | null> {
  const story = await getStoryBySlug(`${ARTICLES_FOLDER}/${slug}`);
  return story ?? null;
}

export async function createArticle(articleData: {
  title: string;
  subtitle?: string | null;
  slug: string;
  category?: string | null;
  excerpt?: string | null;
  body_json?: object | null;
  read_minutes?: number | null;
  published: boolean;
  published_at?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_og_image?: string | null;
}): Promise<SbArticleStory> {
  const folderId = await getFolderId(ARTICLES_FOLDER);
  const content: SbArticleContent = {
    component: 'article',
    title: articleData.title,
    subtitle: articleData.subtitle ?? '',
    category: articleData.category ?? '',
    excerpt: articleData.excerpt ?? '',
    body: articleData.body_json ?? { type: 'doc', content: [] },
    published_at: articleData.published_at ?? '',
    read_minutes: articleData.read_minutes ?? 0,
    ...(articleData.seo_title ? { seo_title: articleData.seo_title } : {}),
    ...(articleData.seo_description ? { seo_description: articleData.seo_description } : {}),
    ...(articleData.seo_og_image ? { seo_og_image: articleData.seo_og_image } : {}),
  };
  const res = await mapi('POST', '/stories/', {
    story: {
      name: articleData.title,
      slug: articleData.slug,
      parent_id: folderId,
      content,
    },
    publish: articleData.published ? 1 : 0,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err));
  }
  const data = await res.json();
  return data.story;
}

export async function updateArticle(
  storyId: number,
  articleData: {
    title?: string;
    subtitle?: string | null;
    slug?: string;
    category?: string | null;
    excerpt?: string | null;
    body_json?: object | null;
    read_minutes?: number | null;
    published?: boolean;
    published_at?: string | null;
    seo_title?: string | null;
    seo_description?: string | null;
    seo_og_image?: string | null;
  },
): Promise<SbArticleStory> {
  // Get current story first
  const existing = await mapiGet(`/stories/${storyId}`);
  const current = existing.story;
  const content: SbArticleContent = {
    ...current.content,
    component: 'article',
    ...(articleData.title !== undefined && { title: articleData.title }),
    ...(articleData.subtitle !== undefined && { subtitle: articleData.subtitle ?? '' }),
    ...(articleData.category !== undefined && { category: articleData.category ?? '' }),
    ...(articleData.excerpt !== undefined && { excerpt: articleData.excerpt ?? '' }),
    ...(articleData.body_json !== undefined && { body: articleData.body_json ?? { type: 'doc', content: [] } }),
    ...(articleData.read_minutes !== undefined && { read_minutes: articleData.read_minutes ?? 0 }),
    ...(articleData.published_at !== undefined && { published_at: articleData.published_at ?? '' }),
    ...(articleData.seo_title !== undefined && { seo_title: articleData.seo_title ?? '' }),
    ...(articleData.seo_description !== undefined && { seo_description: articleData.seo_description ?? '' }),
    ...(articleData.seo_og_image !== undefined && { seo_og_image: articleData.seo_og_image ?? '' }),
  };
  const storyPayload: Record<string, unknown> = {
    ...current,
    content,
    ...(articleData.title !== undefined && { name: articleData.title }),
    ...(articleData.slug !== undefined && { slug: articleData.slug }),
  };
  const published = articleData.published ?? current.published;
  const res = await mapi('PUT', `/stories/${storyId}`, {
    story: storyPayload,
    publish: published ? 1 : 0,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err));
  }
  const data = await res.json();
  return data.story;
}

export async function publishArticle(storyId: number): Promise<void> {
  const res = await mapi('GET', `/stories/${storyId}/publish` as never);
  if (!res.ok) throw new Error(`Failed to publish story ${storyId}`);
}

export async function deleteArticle(storyId: number): Promise<void> {
  const res = await mapi('DELETE', `/stories/${storyId}`);
  if (!res.ok) throw new Error(`Failed to delete story ${storyId}`);
}

// ─────────────────────────────────────────────
// Site Text
// ─────────────────────────────────────────────

export async function listSiteText(): Promise<SbSiteTextStory[]> {
  const data = await cdnGet('/stories', {
    starts_with: SITE_TEXT_FOLDER + '/',
    per_page: '100',
  });
  return (data?.stories ?? []).filter(
    (s: SbSiteTextStory) => s.content?.component === 'site_text',
  );
}

export async function getSiteText(key: string): Promise<SbSiteTextStory | null> {
  const slug = key.replace(/\./g, '-');
  const story = await getStoryBySlug(`${SITE_TEXT_FOLDER}/${slug}`);
  return story ?? null;
}

export async function upsertSiteText(
  key: string,
  value: string,
  description?: string,
): Promise<void> {
  const slug = key.replace(/\./g, '-');
  const fullSlug = `${SITE_TEXT_FOLDER}/${slug}`;
  const existing = await getStoryBySlug(fullSlug);

  if (existing) {
    const content: SbSiteTextContent = {
      ...existing.content,
      component: 'site_text',
      key,
      value,
      ...(description !== undefined ? { description } : {}),
    };
    const res = await mapi('PUT', `/stories/${existing.id}`, {
      story: { ...existing, content },
      publish: 1,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(JSON.stringify(err));
    }
  } else {
    const folderId = await getFolderId(SITE_TEXT_FOLDER);
    const content: SbSiteTextContent = {
      component: 'site_text',
      key,
      value,
      ...(description !== undefined ? { description } : {}),
    };
    const res = await mapi('POST', '/stories/', {
      story: { name: key, slug, parent_id: folderId, content },
      publish: 1,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(JSON.stringify(err));
    }
  }
}

// ─────────────────────────────────────────────
// Book
// ─────────────────────────────────────────────

export async function getBook(): Promise<SbBookStory | null> {
  // The book story lives at book-folder/book
  const story = await getStoryBySlug(`${BOOK_FOLDER}/book`);
  return story ?? null;
}

export async function updateBook(bookData: Partial<SbBookContent>): Promise<SbBookStory> {
  const existing = await getBook();
  if (!existing) throw new Error('Book story not found in Storyblok');
  const content: SbBookContent = {
    ...existing.content,
    component: 'book',
    ...bookData,
  };
  const res = await mapi('PUT', `/stories/${existing.id}`, {
    story: { ...existing, content },
    publish: 1,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err));
  }
  const data = await res.json();
  return data.story;
}

// ─────────────────────────────────────────────
// SEO Defaults
// ─────────────────────────────────────────────

export async function getSeoDefaults(): Promise<SbSeoDefaultsStory | null> {
  const story = await getStoryBySlug('seo-defaults');
  return story ?? null;
}

export async function updateSeoDefaults(
  seoData: Partial<SbSeoDefaultsContent>,
): Promise<SbSeoDefaultsStory> {
  const existing = await getSeoDefaults();
  if (!existing) throw new Error('SEO defaults story not found in Storyblok');
  const content: SbSeoDefaultsContent = {
    ...existing.content,
    component: 'seo_defaults',
    ...seoData,
  };
  const res = await mapi('PUT', `/stories/${existing.id}`, {
    story: { ...existing, content },
    publish: 1,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err));
  }
  const data = await res.json();
  return data.story;
}

// ─────────────────────────────────────────────
// Article SEO overrides (convenience wrappers)
// ─────────────────────────────────────────────

export async function updateArticleSeo(
  storyId: number,
  seoData: { seo_title?: string; seo_description?: string; seo_og_image?: string },
): Promise<SbArticleStory> {
  return updateArticle(storyId, seoData as Parameters<typeof updateArticle>[1]);
}
