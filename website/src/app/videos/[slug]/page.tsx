import type { Metadata } from "next";
import Link from "next/link";
import { getAllParshiot, getParshaBySlug, getNearbyParshiot, ALL_PARSHA_SLUGS } from "@/lib/parshiot";
import { partnerSlugOf, combinedNameWithPartner } from "@/lib/parsha-display";
import VideoCard from "@/components/VideoCard";
import ShareRow from "@/components/ShareRow";
import WatchOnRow from "@/components/WatchOnRow";
import VideoPlayer from "@/components/VideoPlayer";
import { videoSchema, breadcrumbSchema } from "@/lib/jsonld";
import { getSiteContent } from "@/lib/site-content";

// ISR: revalidate every 300 s (5 min); new slugs served on demand
export const revalidate = 300;
export const dynamicParams = true;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  // Pre-generate ONLY parshiot/holidays that have a published video at
  // build time. With dynamicParams=true (set at the top of this file),
  // any other slug a visitor reaches generates on-demand and caches per
  // the revalidate window. This was the build-time fix for repeated
  // /videos/pesach and /videos/simchat-torah SSG timeouts (Supabase
  // round-trips for those specific slugs occasionally exceed the 60 s
  // worker cap, failing the whole Vercel deploy; Yonah 2026-06-02 saw
  // my /videos page-filter changes not land because of this).
  try {
    const parshiot = await getAllParshiot();
    const withVideo = parshiot.filter((p) => p.videoPublishedAt);
    if (withVideo.length > 0) {
      return withVideo.map((p) => ({ slug: p.slug }));
    }
  } catch {
    // fall through to empty array — every page generates on demand
  }
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const parsha = await getParshaBySlug(slug);
    if (!parsha) return { title: "Teaching" };
    // Combined name for double-parsha weeks (e.g. "Matot-Masei"). Resolve the
    // partner with one lookup only when this slug is a pair-lead.
    const partnerSlug = partnerSlugOf(slug);
    const partner = partnerSlug ? await getParshaBySlug(partnerSlug) : null;
    const displayName = combinedNameWithPartner(parsha, partner);
    // Prefer the operator-set creative copy from the dashboard editor.
    // videoSubtitle is the per-video teaching headline ("Who Moved My
    // Cloud?…"); videoDescription is the marketing body. Both fall back
    // to derived defaults when the operator hasn't set them.
    const excerpt = parsha.videoDescription
      ?? (parsha.atightScript
        ? parsha.atightScript.slice(0, 160).replace(/\s+\S*$/, "") + "…"
        : `Parshat ${displayName}. A Torah Tai Chi teaching — where tradition meets the body.`);
    const headlineTitle = parsha.videoSubtitle
      ? `${displayName} · ${parsha.videoSubtitle}`
      : `${displayName} · Torah Tai Chi`;
    const ogImageUrl = `/og/parsha/${slug}`;
    return {
      title: parsha.videoSubtitle ?? displayName,
      description: excerpt,
      alternates: {
        canonical: `https://torahtaichi.com/videos/${slug}`,
      },
      openGraph: {
        title: headlineTitle,
        description: excerpt,
        type: "video.other",
        url: `https://torahtaichi.com/videos/${slug}`,
        siteName: "Torah Tai Chi",
        images: [{ url: ogImageUrl, width: 1200, height: 630 }],
      },
      twitter: {
        card: "summary_large_image",
        title: headlineTitle,
        description: excerpt,
      },
    };
  } catch {
    return { title: "Teaching" };
  }
}

// Hebrew book names — the brand's chosen voice. The DB still stores
// English ("Leviticus" etc.) for legacy reasons, so we map both shapes
// to the Hebrew display name.
const BOOK_SHORT: Record<string, string> = {
  Genesis: "Bereishit",
  Exodus: "Shemot",
  Leviticus: "Vayikra",
  Numbers: "Bamidbar",
  Deuteronomy: "Devarim",
  Bereishit: "Bereishit",
  Shemot: "Shemot",
  Vayikra: "Vayikra",
  Bamidbar: "Bamidbar",
  Devarim: "Devarim",
};

export default async function VideoDetailPage({ params }: Props) {
  const { slug } = await params;

  let parsha = null;
  let nearby: { prev?: { name: string; slug: string; book: string; hebrewName: string }; next?: { name: string; slug: string; book: string; hebrewName: string } } = {};

  let partner: Awaited<ReturnType<typeof getParshaBySlug>> = null;
  try {
    parsha = await getParshaBySlug(slug);
    nearby = await getNearbyParshiot(slug);
    // Resolve the double-parsha partner (one lookup, only for pair-leads) so
    // e.g. /videos/matot reads "Matot-Masei" when they were taught together.
    const partnerSlug = partnerSlugOf(slug);
    if (partnerSlug) partner = await getParshaBySlug(partnerSlug);
  } catch {
    // fallback to empty
  }

  const displayName = parsha ? combinedNameWithPartner(parsha, partner) : "";

  const content = await getSiteContent();

  const nearbyList = [nearby.prev, nearby.next].filter(Boolean) as Array<{
    name: string;
    slug: string;
    book: string;
    hebrewName: string;
  }>;

  const scriptParagraphs = parsha?.atightScript
    ? parsha.atightScript.split(/\n\n+/).filter(Boolean)
    : [];

  const vidSchemaJson = parsha
    ? JSON.stringify(
        videoSchema({
          name: displayName,
          description: parsha.atightScript
            ? parsha.atightScript.slice(0, 160).replace(/\s+\S*$/, "") + "…"
            : null,
          slug,
        })
      )
    : null;

  const crumbSchemaJson = parsha
    ? JSON.stringify(
        breadcrumbSchema([
          { name: "Home", url: "https://torahtaichi.com" },
          { name: "Teachings", url: "https://torahtaichi.com/videos" },
          { name: displayName, url: `https://torahtaichi.com/videos/${slug}` },
        ])
      )
    : null;

  return (
    <>
      {vidSchemaJson && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: vidSchemaJson }} />
      )}
      {crumbSchemaJson && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: crumbSchemaJson }} />
      )}
      <div className="back-wrap">
        <Link href="/videos" className="back-link">
          {content['video_detail.back_link']}
        </Link>
      </div>

      {parsha ? (
        <>
          <header className="vd-header stagger">
            <div className="vd-header-row">
              <h1 className="vd-eng">
                {displayName}
                <em>.</em>
              </h1>
              <div className="vd-heb" lang="he" dir="rtl">
                {parsha.hebrewName}
              </div>
            </div>
            <div className="vd-meta">{BOOK_SHORT[parsha.book] ?? parsha.book}</div>
            {parsha.videoSubtitle && (
              <p className="vd-subtitle">{parsha.videoSubtitle}</p>
            )}
            {parsha.videoDescription && (
              <p className="vd-description">{parsha.videoDescription}</p>
            )}
          </header>

          <div className="vd-player-wrap stagger">
            <div className="vd-player">
              {parsha.videoUrl ? (
                <VideoPlayer
                  src={parsha.videoUrl}
                  poster={parsha.thumbUrl ?? undefined}
                  className="vd-video-el"
                  videoId={parsha.slug}
                  title={parsha.name}
                />
              ) : (
                <>
                  <div className="play">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  <div className="vlabel">
                    {displayName} &middot; {content['video_detail.coming_soon_suffix']}
                  </div>
                </>
              )}
            </div>
          </div>

          <article className="vd-script stagger">
            <div className="vd-script-kicker">
              <span className="bar"></span>
              {content['video_detail.script.kicker']}
              <span className="bar"></span>
            </div>
            {scriptParagraphs.length > 0 ? (
              scriptParagraphs.map((para, i) => (
                <p key={i}>{para}</p>
              ))
            ) : (
              <p>
                <em>{content['video_detail.script.empty']}</em>
              </p>
            )}
          </article>

          {parsha.postUrls && Object.keys(parsha.postUrls).length > 0 ? (
            <WatchOnRow postUrls={parsha.postUrls} label={content['share.watch_on_label']} />
          ) : (
            <ShareRow
              url={`https://torahtaichi.com/videos/${slug}`}
              title={parsha.atightTitle ?? `${displayName} — Torah Tai Chi`}
              label={content['share.share_label']}
            />
          )}
        </>
      ) : (
        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "48px 48px 0" }}>
          <h1 style={{ fontFamily: "var(--ff-display)", color: "var(--ink-900)" }}>
            {content['video_detail.not_found.title']}
          </h1>
          <p>
            <Link href="/videos">{content['video_detail.not_found.cta']}</Link>
          </p>
        </div>
      )}

      {nearbyList.length > 0 && (
        <section className="more-section">
          <div className="more-head">
            <h2>
              {content['video_detail.more.heading_before_em']}<em>{content['video_detail.more.heading_em']}</em>
            </h2>
            <Link href="/videos" className="more">
              {content['video_detail.more.cta_label']}
            </Link>
          </div>
          <div className="more-grid stagger">
            {nearbyList.map((p) => (
              <VideoCard
                key={p.slug}
                parsha={{
                  name: p.name,
                  slug: p.slug,
                  bookShortName: BOOK_SHORT[p.book] ?? p.book,
                  hebrewName: p.hebrewName,
                  date: "",
                }}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
