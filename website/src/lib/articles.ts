/**
 * Articles — fetched from Storyblok Content Delivery API (preview token, read-only).
 * Component: "article"  |  Folder: articles/
 */

const PREVIEW_TOKEN = process.env.STORYBLOK_PREVIEW_TOKEN!;
const CDN_BASE = 'https://api.storyblok.com/v2/cdn';

export type ArticleCategory = 'Essay' | 'Teaching' | 'Reflection';

export interface Article {
  id: string;          // Storyblok numeric id as string
  slug: string;        // e.g. "naase-vnishma"
  full_slug: string;   // e.g. "articles/naase-vnishma"
  title: string;
  subtitle: string | null;
  category: ArticleCategory | null;
  excerpt: string | null;
  body_json: object | null;   // Storyblok richtext doc (ProseMirror)
  body_html: string | null;   // derived from body_json
  read_minutes: number | null;
  published: boolean;
  published_at: string | null;
}

// ─────────────────────────────────────────────
// Storyblok richtext -> HTML (lightweight)
// ─────────────────────────────────────────────

export function tiptapJsonToHtml(doc: object | null): string {
  if (!doc) return '';
  try {
    const root = doc as { type: string; content?: unknown[] };
    if (root.type !== 'doc' || !Array.isArray(root.content)) return '';

    function nodeToHtml(node: unknown): string {
      const n = node as {
        type: string;
        text?: string;
        content?: unknown[];
        marks?: { type: string; attrs?: Record<string, string> }[];
        attrs?: Record<string, unknown>;
      };
      if (n.type === 'text') {
        let t = (n.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (n.marks) {
          for (const mark of n.marks) {
            if (mark.type === 'bold') t = `<strong>${t}</strong>`;
            if (mark.type === 'italic') t = `<em>${t}</em>`;
            if (mark.type === 'link') t = `<a href="${mark.attrs?.href ?? ''}">${t}</a>`;
          }
        }
        return t;
      }
      const inner = (n.content ?? []).map(nodeToHtml).join('');
      switch (n.type) {
        case 'paragraph': return `<p>${inner}</p>`;
        case 'heading': return `<h${n.attrs?.level ?? 2}>${inner}</h${n.attrs?.level ?? 2}>`;
        case 'bulletList': return `<ul>${inner}</ul>`;
        case 'orderedList': return `<ol>${inner}</ol>`;
        case 'listItem': return `<li>${inner}</li>`;
        case 'blockquote': return `<blockquote>${inner}</blockquote>`;
        case 'hardBreak': return '<br/>';
        default: return inner;
      }
    }

    return root.content.map(nodeToHtml).join('');
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// Map a Storyblok story -> Article
// ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function storyToArticle(story: any): Article {
  const c = story.content ?? {};
  const bodyDoc = (c.body && typeof c.body === 'object') ? c.body as object : null;
  return {
    id: String(story.id),
    slug: story.slug,
    full_slug: story.full_slug,
    title: c.title ?? '',
    subtitle: c.subtitle || null,
    category: (c.category as ArticleCategory) || null,
    excerpt: c.excerpt || null,
    body_json: bodyDoc,
    body_html: tiptapJsonToHtml(bodyDoc),
    read_minutes: c.read_minutes ? Number(c.read_minutes) : null,
    published: true,  // CDN only returns published stories
    published_at: c.published_at || story.published_at || null,
  };
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function getAllArticles(): Promise<Article[]> {
  try {
    const url = new URL(`${CDN_BASE}/stories`);
    url.searchParams.set('token', PREVIEW_TOKEN);
    url.searchParams.set('starts_with', 'articles/');
    url.searchParams.set('filter_query[component][in]', 'article');
    url.searchParams.set('sort_by', 'content.published_at:desc');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('version', 'published');

    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.stories ?? []).map(storyToArticle);
  } catch {
    return [];
  }
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  try {
    const url = new URL(`${CDN_BASE}/stories/articles/${slug}`);
    url.searchParams.set('token', PREVIEW_TOKEN);
    url.searchParams.set('version', 'published');

    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.story) return null;
    return storyToArticle(data.story);
  } catch {
    return null;
  }
}
