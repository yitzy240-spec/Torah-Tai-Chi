import { supabase } from './supabase';
import { hebrewNames } from '../data/hebrew-names';

export interface Parsha {
  id: string;
  order: number;
  name: string;
  slug: string;
  book: string;
  hebrewName: string;
  script?: string;
}

function bookShortName(book: string): string {
  if (book.includes('Genesis')) return 'Genesis';
  if (book.includes('Exodus')) return 'Exodus';
  if (book.includes('Leviticus')) return 'Leviticus';
  if (book.includes('Numbers')) return 'Numbers';
  if (book.includes('Deuteronomy')) return 'Deuteronomy';
  return book;
}

function enrichParsha(row: any): Parsha {
  return {
    id: row.id,
    order: row.order,
    name: row.name,
    slug: row.slug,
    book: bookShortName(row.book),
    hebrewName: row.hebrew_name || hebrewNames[row.slug] || '',
    script: row.draft_text ?? undefined,
  };
}

export async function getAllParshiot(): Promise<Parsha[]> {
  // Fetch parshiot that have an A-tight script by joining via scripts
  const { data: scriptData, error: scriptErr } = await supabase
    .from('scripts')
    .select('parsha_id, draft_text')
    .eq('option', 'A-tight');

  if (scriptErr || !scriptData) return [];

  const scriptMap = new Map(scriptData.map((s: any) => [s.parsha_id, s.draft_text]));
  const parshiotIds = scriptData.map((s: any) => s.parsha_id);

  const { data, error } = await supabase
    .from('parshiot')
    .select('id, order, name, slug, book, hebrew_name')
    .in('id', parshiotIds)
    .order('order');

  if (error || !data) return [];

  return data.map((row: any) => ({
    ...enrichParsha(row),
    script: scriptMap.get(row.id) ?? undefined,
  }));
}

export async function getParshaBySlug(slug: string): Promise<Parsha | null> {
  const { data, error } = await supabase
    .from('parshiot')
    .select(`
      id, order, name, slug, book, hebrew_name,
      scripts(draft_text, option)
    `)
    .eq('slug', slug)
    .single();

  if (error || !data) return null;

  const atightScript = data.scripts?.find((s: any) => s.option === 'A-tight');

  return {
    ...enrichParsha(data),
    script: atightScript?.draft_text ?? undefined,
  };
}

export async function getNearbyParshiot(slug: string): Promise<{ prev: Parsha | null; next: Parsha | null }> {
  const current = await getParshaBySlug(slug);
  if (!current) return { prev: null, next: null };

  const all = await getAllParshiot();
  const idx = all.findIndex(p => p.slug === slug);

  const prev = idx > 0 ? all[idx - 1] : null;
  const next = idx < all.length - 1 ? all[idx + 1] : null;

  return { prev, next };
}
