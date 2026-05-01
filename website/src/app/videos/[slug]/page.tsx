import type { Metadata } from "next";
import Link from "next/link";
import { getAllParshiot, getParshaBySlug, getNearbyParshiot, ALL_PARSHA_SLUGS } from "@/lib/parshiot";
import VideoCard from "@/components/VideoCard";
import ShareRow from "@/components/ShareRow";
import WatchOnRow from "@/components/WatchOnRow";
import { videoSchema, breadcrumbSchema } from "@/lib/jsonld";
import { getSiteContent } from "@/lib/site-content";

// ISR: revalidate every 300 s (5 min); new slugs served on demand
export const revalidate = 300;
export const dynamicParams = true;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  try {
    const parshiot = await getAllParshiot();
    if (parshiot.length > 0) {
      return parshiot.map((p) => ({ slug: p.slug }));
    }
  } catch {
    // fall through to static list
  }
  // Fallback: use all known parsha slugs from the Hebrew names map
  return ALL_PARSHA_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const parsha = await getParshaBySlug(slug);
    if (!parsha) return { title: "Teaching" };
    const excerpt = parsha.atightScript
      ? parsha.atightScript.slice(0, 160).replace(/\s+\S*$/, "") + "…"
      : `Parshat ${parsha.name}. A Torah Tai Chi teaching — where tradition meets the body.`;
    const ogImageUrl = `/og/parsha/${slug}`;
    return {
      title: parsha.name,
      description: excerpt,
      alternates: {
        canonical: `https://torahtaichi.com/videos/${slug}`,
      },
      openGraph: {
        title: `${parsha.name} · Torah Tai Chi`,
        description: excerpt,
        type: "video.other",
        url: `https://torahtaichi.com/videos/${slug}`,
        siteName: "Torah Tai Chi",
        images: [{ url: ogImageUrl, width: 1200, height: 630 }],
      },
      twitter: {
        card: "summary_large_image",
        title: `${parsha.name} · Torah Tai Chi`,
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

  try {
    parsha = await getParshaBySlug(slug);
    nearby = await getNearbyParshiot(slug);
  } catch {
    // fallback to empty
  }

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
          name: parsha.name,
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
          { name: parsha.name, url: `https://torahtaichi.com/videos/${slug}` },
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
                {parsha.name}
                <em>.</em>
              </h1>
              <div className="vd-heb" lang="he" dir="rtl">
                {parsha.hebrewName}
              </div>
            </div>
            <div className="vd-meta">{BOOK_SHORT[parsha.book] ?? parsha.book}</div>
          </header>

          <div className="vd-player-wrap stagger">
            <div className="vd-player">
              {parsha.videoUrl ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={parsha.videoUrl}
                  poster={parsha.thumbUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="vd-video-el"
                />
              ) : (
                <>
                  <div className="play">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  <div className="vlabel">
                    {parsha.name} &middot; {content['video_detail.coming_soon_suffix']}
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
              title={parsha.atightTitle ?? `${parsha.name} — Torah Tai Chi`}
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
