import { supabaseClient } from "./supabase";
import { HEBREW_NAMES } from "@/data/hebrew-names";

export interface Parsha {
  id: string;
  order: number;
  name: string;
  slug: string;
  book: string;
  hebrewName: string;
  atightScript?: string;
  atightTitle?: string;
}

// All known slugs for generateStaticParams fallback
export const ALL_PARSHA_SLUGS = Object.keys(HEBREW_NAMES);

export async function getAllParshiot(): Promise<Parsha[]> {
  const client = supabaseClient();

  // Fetch parshiot
  const { data: parshiotData, error: parshiotError } = await client
    .from("parshiot")
    .select(`id, "order", name, slug, book`)
    .order('"order"', { ascending: true });

  if (parshiotError) {
    console.error("Error fetching parshiot:", parshiotError);
    return [];
  }

  if (!parshiotData || parshiotData.length === 0) return [];

  // Fetch A-tight scripts
  const parshaIds = parshiotData.map((p: { id: string }) => p.id);
  const { data: scriptsData } = await client
    .from("scripts")
    .select("parsha_id, title, draft_text")
    .in("parsha_id", parshaIds)
    .eq("option", "A-tight");

  const scriptMap = new Map<string, { title: string; draft_text: string }>();
  for (const s of scriptsData ?? []) {
    scriptMap.set(s.parsha_id, s);
  }

  return parshiotData.map((row: { id: string; order: number; name: string; slug: string; book: string }) => {
    const script = scriptMap.get(row.id);
    return {
      id: row.id,
      order: row.order,
      name: row.name,
      slug: row.slug,
      book: row.book,
      hebrewName: HEBREW_NAMES[row.slug] ?? "",
      atightScript: script?.draft_text,
      atightTitle: script?.title,
    };
  });
}

export async function getParshaBySlug(slug: string): Promise<Parsha | null> {
  const client = supabaseClient();

  const { data: parshaData, error } = await client
    .from("parshiot")
    .select(`id, "order", name, slug, book`)
    .eq("slug", slug)
    .single();

  if (error || !parshaData) {
    console.error("Error fetching parsha:", error);
    return null;
  }

  const { data: scriptData } = await client
    .from("scripts")
    .select("title, draft_text")
    .eq("parsha_id", parshaData.id)
    .eq("option", "A-tight")
    .single();

  return {
    id: parshaData.id,
    order: parshaData.order,
    name: parshaData.name,
    slug: parshaData.slug,
    book: parshaData.book,
    hebrewName: HEBREW_NAMES[parshaData.slug] ?? "",
    atightScript: scriptData?.draft_text,
    atightTitle: scriptData?.title,
  };
}

export async function getNearbyParshiot(
  slug: string
): Promise<{ prev?: Parsha; next?: Parsha }> {
  const current = await getParshaBySlug(slug);
  if (!current) return {};

  const client = supabaseClient();

  const [prevResult, nextResult] = await Promise.all([
    client
      .from("parshiot")
      .select(`id, "order", name, slug, book`)
      .lt('"order"', current.order)
      .order('"order"', { ascending: false })
      .limit(1),
    client
      .from("parshiot")
      .select(`id, "order", name, slug, book`)
      .gt('"order"', current.order)
      .order('"order"', { ascending: true })
      .limit(1),
  ]);

  const mapRow = (row: { id: string; order: number; name: string; slug: string; book: string }): Parsha => ({
    id: row.id,
    order: row.order,
    name: row.name,
    slug: row.slug,
    book: row.book,
    hebrewName: HEBREW_NAMES[row.slug] ?? "",
  });

  return {
    prev: prevResult.data?.[0] ? mapRow(prevResult.data[0]) : undefined,
    next: nextResult.data?.[0] ? mapRow(nextResult.data[0]) : undefined,
  };
}
