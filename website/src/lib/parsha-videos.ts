// website/src/lib/parsha-videos.ts
//
// A parsha keeps every teaching it has ever published. Each year's video —
// and any other idea taught on the same parsha — stays live: the newest is
// the HERO the page is built around, and the rest are EARLIER TEACHINGS
// behind a button. Nothing a visitor has linked to is ever taken down.
// (Yitzy, 2026-10-04: "hero this years one and have a button to view
// previous years/other ideas-videos for this parsha. Ultimately the content
// never gets stale.")
//
// Kept free of Supabase / env imports so it unit-tests under plain node.

export type PostUrls = Partial<
  Record<"tiktok" | "instagram" | "youtube" | "facebook" | "twitter", string>
>;

/** A published `videos` row as the website reads it (anon RLS already
 *  filters to published_to_website = true). */
export interface VideoRow {
  id: string;
  parsha_id?: string | null;
  thumb_path: string | null;
  mp4_path: string | null;
  website_caption: string | null;
  spoken_script: string | null;
  post_urls: Record<string, string> | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  created_at: string | null;
}

/** One earlier teaching, shaped for the client-side list. Serializable. */
export interface ParshaVideo {
  id: string;
  title: string | null;
  subtitle: string | null;
  thumbUrl: string | null;
  videoUrl: string;
  postUrls?: PostUrls;
  publishedAt: string | null;
  /** Hebrew year the video was made — "5786". Null if the date is missing. */
  hebrewYear: string | null;
}

const HEBREW_YEAR = new Intl.DateTimeFormat("en-u-ca-hebrew", { year: "numeric" });

/**
 * Hebrew year of an ISO timestamp, e.g. "5786".
 *
 * This is the year the video was MADE, not necessarily the year its parsha
 * was read: Bereishit is read a few weeks after Rosh Hashana, so a Bereishit
 * video stitched in Elul carries the outgoing year. Close enough for a
 * label — and the only date the row actually has.
 */
export function hebrewYearOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return HEBREW_YEAR.format(d);
}

/** Newest first by created_at; rows with no date sort last. */
export function newestFirst<T extends { created_at: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.created_at === b.created_at) return 0;
    if (a.created_at === null) return 1;
    if (b.created_at === null) return -1;
    return a.created_at < b.created_at ? 1 : -1;
  });
}

/**
 * Split one parsha's published videos into the hero and the earlier ones.
 *
 * The hero is the newest. That's "this year's" teaching once there's more
 * than one, and it's what every existing per-parsha field (thumbnail, mp4,
 * title, script, social links) has to come from as a WHOLE. Reading those
 * fields row-by-row across several videos — which a last-write-wins loop
 * over an unordered result does — would stitch one video's thumbnail onto
 * another's mp4.
 *
 * Earlier videos without an mp4 are dropped: there's nothing to play.
 */
export function splitHero(
  rows: readonly VideoRow[],
  urlFor: (path: string) => string,
): { hero: VideoRow | null; earlier: ParshaVideo[] } {
  const sorted = newestFirst(rows);
  const [hero = null, ...rest] = sorted;
  const earlier = rest
    .filter((v) => v.mp4_path)
    .map((v) => ({
      id: v.id,
      title: v.title,
      subtitle: v.subtitle,
      thumbUrl: v.thumb_path ? urlFor(v.thumb_path) : null,
      videoUrl: urlFor(v.mp4_path as string),
      postUrls:
        v.post_urls && Object.keys(v.post_urls).length > 0
          ? (v.post_urls as PostUrls)
          : undefined,
      publishedAt: v.created_at,
      hebrewYear: hebrewYearOf(v.created_at),
    }));
  return { hero, earlier };
}

/** Group rows by parsha_id. Order within a group is preserved; callers
 *  sort via splitHero. Rows without a parsha_id are skipped. */
export function groupByParsha(rows: readonly VideoRow[]): Map<string, VideoRow[]> {
  const groups = new Map<string, VideoRow[]>();
  for (const v of rows) {
    if (!v.parsha_id) continue;
    const g = groups.get(v.parsha_id);
    if (g) g.push(v);
    else groups.set(v.parsha_id, [v]);
  }
  return groups;
}
