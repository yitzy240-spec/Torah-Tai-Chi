import { supabaseClient } from "./supabase";
import { HEBREW_NAMES } from "@/data/hebrew-names";

const SUPABASE_STORAGE_URL =
  "https://jswdfthmegjbhnwbgeca.supabase.co/storage/v1/object/public/videos/";

export interface Parsha {
  id: string;
  order: number;
  name: string;
  slug: string;
  book: string;
  hebrewName: string;
  atightScript?: string;
  atightTitle?: string;
  /** Feature B: full public URL for the video thumbnail, or null if none yet */
  thumbUrl?: string | null;
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

  const parshaIds = parshiotData.map((p: { id: string }) => p.id);

  // Fetch A-tight scripts and videos in parallel
  const [scriptsResult, videosResult] = await Promise.all([
    client
      .from("scripts")
      .select("parsha_id, title, draft_text")
      .in("parsha_id", parshaIds)
      .eq("option", "A-tight"),
    client
      .from("videos")
      .select("thumb_path, jobs!inner(parsha_id)")
      .in("jobs.parsha_id", parshaIds),
  ]);

  const scriptMap = new Map<string, { title: string; draft_text: string }>();
  for (const s of scriptsResult.data ?? []) {
    scriptMap.set(s.parsha_id, s);
  }

  const thumbMap = new Map<string, string | null>();
  for (const v of (videosResult.data ?? []) as Array<{
    thumb_path: string | null;
    jobs: { parsha_id: string } | { parsha_id: string }[] | null;
  }>) {
    if (!v.thumb_path || !v.jobs) continue;
    const parshaId = Array.isArray(v.jobs) ? v.jobs[0]?.parsha_id : v.jobs.parsha_id;
    if (parshaId) thumbMap.set(parshaId, v.thumb_path);
  }

  return parshiotData.map((row: { id: string; order: number; name: string; slug: string; book: string }) => {
    const script = scriptMap.get(row.id);
    const thumbPath = thumbMap.get(row.id) ?? null;
    return {
      id: row.id,
      order: row.order,
      name: row.name,
      slug: row.slug,
      book: row.book,
      hebrewName: HEBREW_NAMES[row.slug] ?? "",
      atightScript: script?.draft_text,
      atightTitle: script?.title,
      thumbUrl: thumbPath ? `${SUPABASE_STORAGE_URL}${thumbPath}` : null,
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

  const [scriptResult, videoResult] = await Promise.all([
    client
      .from("scripts")
      .select("title, draft_text")
      .eq("parsha_id", parshaData.id)
      .eq("option", "A-tight")
      .single(),
    client
      .from("videos")
      .select("thumb_path")
      .eq("parsha_id", parshaData.id)
      .maybeSingle(),
  ]);

  const thumbPath = videoResult.data?.thumb_path ?? null;

  return {
    id: parshaData.id,
    order: parshaData.order,
    name: parshaData.name,
    slug: parshaData.slug,
    book: parshaData.book,
    hebrewName: HEBREW_NAMES[parshaData.slug] ?? "",
    atightScript: scriptResult.data?.draft_text,
    atightTitle: scriptResult.data?.title,
    thumbUrl: thumbPath ? `${SUPABASE_STORAGE_URL}${thumbPath}` : null,
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
