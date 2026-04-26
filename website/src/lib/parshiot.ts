import { supabaseClient } from "./supabase";
import { publicVideoUrl } from "./storage-url";
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
  /** Feature B: full public URL for the video thumbnail, or null if none yet */
  thumbUrl?: string | null;
  /** Public URL for the rendered mp4 — present iff the video has been
   *  published to the site (anon RLS filters unpublished rows out). */
  videoUrl?: string | null;
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

  // Fetch A-tight scripts and videos in parallel.
  //
  // The videos query no longer joins through jobs. Two reasons:
  //  - jobs has internal data (cost, triggered_by) we don't want exposed
  //    via anon RLS,
  //  - videos.parsha_id was denormalized in 20260426_videos_publish_gate
  //    so the website can query it directly.
  // Anon RLS on videos already filters to published_to_website = true,
  // which is the publish gate Yonah controls per-video on the dashboard.
  const [scriptsResult, videosResult] = await Promise.all([
    client
      .from("scripts")
      .select("parsha_id, title, draft_text")
      .in("parsha_id", parshaIds)
      .eq("option", "A-tight"),
    client
      .from("videos")
      .select("parsha_id, thumb_path, mp4_path")
      .in("parsha_id", parshaIds),
  ]);

  const scriptMap = new Map<string, { title: string; draft_text: string }>();
  for (const s of scriptsResult.data ?? []) {
    scriptMap.set(s.parsha_id, s);
  }

  const thumbMap = new Map<string, string | null>();
  const videoMap = new Map<string, string | null>();
  for (const v of (videosResult.data ?? []) as Array<{
    parsha_id: string | null;
    thumb_path: string | null;
    mp4_path: string | null;
  }>) {
    if (!v.parsha_id) continue;
    if (v.thumb_path) thumbMap.set(v.parsha_id, v.thumb_path);
    if (v.mp4_path) videoMap.set(v.parsha_id, v.mp4_path);
  }

  return parshiotData.map((row: { id: string; order: number; name: string; slug: string; book: string }) => {
    const script = scriptMap.get(row.id);
    const thumbPath = thumbMap.get(row.id) ?? null;
    const mp4Path = videoMap.get(row.id) ?? null;
    return {
      id: row.id,
      order: row.order,
      name: row.name,
      slug: row.slug,
      book: row.book,
      hebrewName: HEBREW_NAMES[row.slug] ?? "",
      atightScript: script?.draft_text,
      atightTitle: script?.title,
      thumbUrl: thumbPath ? publicVideoUrl(thumbPath) : null,
      videoUrl: mp4Path ? publicVideoUrl(mp4Path) : null,
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
    // Anon RLS already filters to published_to_website=true. No qa_seed
    // filter needed — that column was for the old seed flow and isn't
    // public-readable anyway.
    client
      .from("videos")
      .select("thumb_path, mp4_path")
      .eq("parsha_id", parshaData.id)
      .maybeSingle(),
  ]);

  const thumbPath = videoResult.data?.thumb_path ?? null;
  const mp4Path = videoResult.data?.mp4_path ?? null;

  return {
    id: parshaData.id,
    order: parshaData.order,
    name: parshaData.name,
    slug: parshaData.slug,
    book: parshaData.book,
    hebrewName: HEBREW_NAMES[parshaData.slug] ?? "",
    atightScript: scriptResult.data?.draft_text,
    atightTitle: scriptResult.data?.title,
    thumbUrl: thumbPath ? publicVideoUrl(thumbPath) : null,
    videoUrl: mp4Path ? publicVideoUrl(mp4Path) : null,
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
