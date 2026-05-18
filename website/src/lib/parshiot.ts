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
  /** 'parsha' (a weekly Torah reading) or 'holiday' (Shavuot, Pesach,
   *  etc.). Holidays publish through the same pipeline but are excluded
   *  from the homepage hero so we don't display e.g. Shavuot as "this
   *  week's teaching." */
  kind: 'parsha' | 'holiday';
  /** ISO timestamp of when the published video's row was inserted.
   *  Used to pick the most-recently-published non-holiday video for the
   *  hero when the upcoming-parsha (per Hebcal) doesn't have a video yet.
   *  Null when no video has been published. */
  videoPublishedAt?: string | null;
  /** Script text shown on the video page. Prefers
   *  videos.spoken_script (the transcript snapshot taken at publish
   *  time, accurate for the live version even after per-clip regens).
   *  Falls back to scripts.draft_text when no published video exists or
   *  the snapshot wasn't written. */
  atightScript?: string;
  atightTitle?: string;
  /** Feature B: full public URL for the video thumbnail, or null if none yet */
  thumbUrl?: string | null;
  /** Public URL for the rendered mp4 — present iff the video has been
   *  published to the site (anon RLS filters unpublished rows out). */
  videoUrl?: string | null;
  /** Marketing-voice description denormalized onto videos.website_caption
   *  (defaults to the auto-generated Instagram caption, kept in sync by
   *  the dashboard caption editor). Falls back to atightScript when
   *  unset. */
  websiteCaption?: string | null;
  /** Per-platform direct URLs for the post on each network (filled in by
   *  the dashboard from autoPost results). Keys: tiktok, instagram,
   *  youtube, facebook, twitter. Missing keys = no post on that platform
   *  (or not yet resolved); the website hides the corresponding button. */
  postUrls?: Partial<Record<'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'twitter', string>>;
}

// All known slugs for generateStaticParams fallback
export const ALL_PARSHA_SLUGS = Object.keys(HEBREW_NAMES);

export async function getAllParshiot(): Promise<Parsha[]> {
  const client = supabaseClient();

  // Fetch parshiot
  const { data: parshiotData, error: parshiotError } = await client
    .from("parshiot")
    .select(`id, "order", name, slug, book, kind`)
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
    // A-tight kept as a defensive fallback (see getParshaBySlug). The
    // real title source is now the script that produced each published
    // video, resolved via the job chain below.
    client
      .from("scripts")
      .select("parsha_id, title, draft_text")
      .in("parsha_id", parshaIds)
      .eq("option", "A-tight"),
    client
      .from("videos")
      .select("parsha_id, job_id, thumb_path, mp4_path, website_caption, spoken_script, post_urls, created_at")
      .in("parsha_id", parshaIds),
  ]);

  const scriptMap = new Map<string, { title: string; draft_text: string }>();
  for (const s of scriptsResult.data ?? []) {
    scriptMap.set(s.parsha_id, s);
  }

  const thumbMap = new Map<string, string | null>();
  const videoMap = new Map<string, string | null>();
  const captionMap = new Map<string, string | null>();
  const spokenScriptMap = new Map<string, string | null>();
  const postUrlsMap = new Map<string, Parsha["postUrls"]>();
  const jobIdMap = new Map<string, string | null>();
  const videoPublishedAtMap = new Map<string, string>();
  for (const v of (videosResult.data ?? []) as Array<{
    parsha_id: string | null;
    job_id: string | null;
    thumb_path: string | null;
    mp4_path: string | null;
    website_caption: string | null;
    spoken_script: string | null;
    post_urls: Record<string, string> | null;
    created_at: string | null;
  }>) {
    if (!v.parsha_id) continue;
    if (v.job_id) jobIdMap.set(v.parsha_id, v.job_id);
    if (v.thumb_path) thumbMap.set(v.parsha_id, v.thumb_path);
    if (v.mp4_path) videoMap.set(v.parsha_id, v.mp4_path);
    if (v.website_caption) captionMap.set(v.parsha_id, v.website_caption);
    if (v.spoken_script) spokenScriptMap.set(v.parsha_id, v.spoken_script);
    if (v.post_urls && Object.keys(v.post_urls).length > 0) {
      postUrlsMap.set(v.parsha_id, v.post_urls as Parsha["postUrls"]);
    }
    if (v.created_at) videoPublishedAtMap.set(v.parsha_id, v.created_at);
  }

  // Resolve the source-script title for each parsha by walking its
  // published video's job chain. Same reasoning as getParshaBySlug:
  // the title shown on the homepage / videos index should match the
  // script that ACTUALLY produced the live video, not a hardcoded
  // A-tight pick. Done sequentially per parsha — fine for ~50 parshiot
  // on an ISR-cached page. If we ever need to optimize: snapshot the
  // title onto videos.title at publish time (see set-video-published).
  const sourceTitleMap = new Map<string, string>();
  for (const [parshaId, jobId] of jobIdMap) {
    if (!jobId) continue;
    let current: string | null = jobId;
    for (let i = 0; i < 25 && current; i++) {
      const { data: j }: { data: { script_id: string | null; regen_of_job_id: string | null } | null } = await client
        .from("jobs")
        .select("script_id, regen_of_job_id")
        .eq("id", current)
        .maybeSingle();
      if (j?.script_id) {
        const { data: src } = await client
          .from("scripts")
          .select("title")
          .eq("id", j.script_id)
          .maybeSingle();
        if (src?.title) sourceTitleMap.set(parshaId, src.title as string);
        break;
      }
      current = (j?.regen_of_job_id as string | null) ?? null;
    }
  }

  return parshiotData.map((row: { id: string; order: number; name: string; slug: string; book: string; kind: string }) => {
    const script = scriptMap.get(row.id);
    const thumbPath = thumbMap.get(row.id) ?? null;
    const mp4Path = videoMap.get(row.id) ?? null;
    const spoken = spokenScriptMap.get(row.id) ?? null;
    const resolvedTitle = sourceTitleMap.get(row.id) ?? script?.title;
    return {
      id: row.id,
      order: row.order,
      name: row.name,
      slug: row.slug,
      book: row.book,
      hebrewName: HEBREW_NAMES[row.slug] ?? "",
      kind: (row.kind === 'holiday' ? 'holiday' : 'parsha') as 'parsha' | 'holiday',
      // Prefer the spoken-script snapshot (matches the live video's
      // actual voiceovers); fall back to the draft when none exists yet.
      atightScript: spoken ?? script?.draft_text,
      atightTitle: resolvedTitle,
      thumbUrl: thumbPath ? publicVideoUrl(thumbPath) : null,
      videoUrl: mp4Path ? publicVideoUrl(mp4Path) : null,
      websiteCaption: captionMap.get(row.id) ?? null,
      postUrls: postUrlsMap.get(row.id),
      videoPublishedAt: videoPublishedAtMap.get(row.id) ?? null,
    };
  });
}

export async function getParshaBySlug(slug: string): Promise<Parsha | null> {
  const client = supabaseClient();

  const { data: parshaData, error } = await client
    .from("parshiot")
    .select(`id, "order", name, slug, book, kind`)
    .eq("slug", slug)
    .single();

  if (error || !parshaData) {
    console.error("Error fetching parsha:", error);
    return null;
  }

  const [atightFallback, videoResult] = await Promise.all([
    // Kept as a defensive fallback: if the published video's job chain
    // doesn't reveal a source script (rare — only happens when something
    // upstream loses script_id), we fall back to the A-tight script for
    // this parsha so the page still has SOME title to show.
    client
      .from("scripts")
      .select("title, draft_text")
      .eq("parsha_id", parshaData.id)
      .eq("option", "A-tight")
      .maybeSingle(),
    // Anon RLS already filters to published_to_website=true. No qa_seed
    // filter needed — that column was for the old seed flow and isn't
    // public-readable anyway.
    client
      .from("videos")
      .select("job_id, thumb_path, mp4_path, website_caption, spoken_script, post_urls, created_at")
      .eq("parsha_id", parshaData.id)
      .maybeSingle(),
  ]);

  // Resolve the title from the script that ACTUALLY produced the
  // published video, not from a hardcoded A-tight pick. Yonah's
  // workflow: pick one of the 4 script options (A / A-tight / B / C),
  // edit clip by clip, then publish. The published video's title
  // shown below the player should match the script he picked.
  //
  // Walk: videos.job_id → jobs.script_id (regens/composes have
  // script_id NULL, so follow regen_of_job_id until we hit a job
  // with script_id set). Bounded depth 25 to defend against any
  // pathological cycle in the data.
  let sourceTitle: string | null = null;
  if (videoResult.data?.job_id) {
    let jobId: string | null = videoResult.data.job_id as string;
    for (let i = 0; i < 25 && jobId; i++) {
      const { data: j }: { data: { script_id: string | null; regen_of_job_id: string | null } | null } = await client
        .from("jobs")
        .select("script_id, regen_of_job_id")
        .eq("id", jobId)
        .maybeSingle();
      if (j?.script_id) {
        const { data: src } = await client
          .from("scripts")
          .select("title")
          .eq("id", j.script_id)
          .maybeSingle();
        if (src?.title) {
          sourceTitle = src.title as string;
        }
        break;
      }
      jobId = (j?.regen_of_job_id as string | null) ?? null;
    }
  }

  const thumbPath = videoResult.data?.thumb_path ?? null;
  const mp4Path = videoResult.data?.mp4_path ?? null;
  const spoken = (videoResult.data as { spoken_script?: string | null } | null)
    ?.spoken_script ?? null;
  const postUrlsRaw = (videoResult.data as { post_urls?: Record<string, string> | null } | null)
    ?.post_urls ?? null;

  return {
    id: parshaData.id,
    order: parshaData.order,
    name: parshaData.name,
    slug: parshaData.slug,
    book: parshaData.book,
    hebrewName: HEBREW_NAMES[parshaData.slug] ?? "",
    kind: ((parshaData as { kind?: string }).kind === 'holiday' ? 'holiday' : 'parsha') as 'parsha' | 'holiday',
    atightScript: spoken ?? atightFallback.data?.draft_text,
    atightTitle: sourceTitle ?? atightFallback.data?.title,
    thumbUrl: thumbPath ? publicVideoUrl(thumbPath) : null,
    videoUrl: mp4Path ? publicVideoUrl(mp4Path) : null,
    websiteCaption: videoResult.data?.website_caption ?? null,
    videoPublishedAt: (videoResult.data as { created_at?: string | null } | null)?.created_at ?? null,
    postUrls: postUrlsRaw && Object.keys(postUrlsRaw).length > 0
      ? (postUrlsRaw as Parsha["postUrls"])
      : undefined,
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
      .select(`id, "order", name, slug, book, kind`)
      .lt('"order"', current.order)
      .order('"order"', { ascending: false })
      .limit(1),
    client
      .from("parshiot")
      .select(`id, "order", name, slug, book, kind`)
      .gt('"order"', current.order)
      .order('"order"', { ascending: true })
      .limit(1),
  ]);

  const mapRow = (row: { id: string; order: number; name: string; slug: string; book: string; kind: string }): Parsha => ({
    id: row.id,
    order: row.order,
    name: row.name,
    slug: row.slug,
    book: row.book,
    hebrewName: HEBREW_NAMES[row.slug] ?? "",
    kind: (row.kind === 'holiday' ? 'holiday' : 'parsha') as 'parsha' | 'holiday',
  });

  return {
    prev: prevResult.data?.[0] ? mapRow(prevResult.data[0]) : undefined,
    next: nextResult.data?.[0] ? mapRow(nextResult.data[0]) : undefined,
  };
}
