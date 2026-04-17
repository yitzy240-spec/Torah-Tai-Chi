import { supabaseClient } from './supabase';

export type ArticleCategory = 'Essay' | 'Teaching' | 'Reflection';

export interface Article {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  category: ArticleCategory | null;
  excerpt: string | null;
  body_json: object | null;
  body_html: string | null;
  read_minutes: number | null;
  published: boolean;
  published_at: string | null;
}

// Convert TipTap JSON doc to simple HTML as a fallback when body_html is absent
export function tiptapJsonToHtml(doc: object | null): string {
  if (!doc) return '';
  try {
    const root = doc as { type: string; content?: unknown[] };
    if (root.type !== 'doc' || !Array.isArray(root.content)) return '';

    function nodeToHtml(node: unknown): string {
      const n = node as { type: string; text?: string; content?: unknown[]; marks?: { type: string; attrs?: Record<string, string> }[]; attrs?: Record<string, unknown> };
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

export async function getAllArticles(): Promise<Article[]> {
  const supabase = supabaseClient();
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, subtitle, category, excerpt, body_json, body_html, read_minutes, published, published_at')
    .eq('published', true)
    .order('published_at', { ascending: false });

  if (error || !data) return [];
  return data as Article[];
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const supabase = supabaseClient();
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, subtitle, category, excerpt, body_json, body_html, read_minutes, published, published_at')
    .eq('published', true)
    .eq('slug', slug)
    .single();

  if (error || !data) return null;
  return data as Article;
}
