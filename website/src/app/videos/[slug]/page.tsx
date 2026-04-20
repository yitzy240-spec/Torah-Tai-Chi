import type { Metadata } from "next";
import Link from "next/link";
import { getAllParshiot, getParshaBySlug, getNearbyParshiot, ALL_PARSHA_SLUGS } from "@/lib/parshiot";
import VideoCard from "@/components/VideoCard";

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

const BOOK_SHORT: Record<string, string> = {
  Genesis: "Genesis",
  Exodus: "Exodus",
  Leviticus: "Leviticus",
  Numbers: "Numbers",
  Deuteronomy: "Deuteronomy",
  Bereishit: "Genesis",
  Shemot: "Exodus",
  Vayikra: "Leviticus",
  Bamidbar: "Numbers",
  Devarim: "Deuteronomy",
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

  const nearbyList = [nearby.prev, nearby.next].filter(Boolean) as Array<{
    name: string;
    slug: string;
    book: string;
    hebrewName: string;
  }>;

  const scriptParagraphs = parsha?.atightScript
    ? parsha.atightScript.split(/\n\n+/).filter(Boolean)
    : [];

  return (
    <>
      <div className="back-wrap">
        <Link href="/videos" className="back-link">
          &larr; All teachings
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
              <div className="play">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <div className="vlabel">
                {parsha.name} &middot; {parsha.atightTitle ?? "~45s"}
              </div>
            </div>
          </div>

          <article className="vd-script stagger">
            <div className="vd-script-kicker">
              <span className="bar"></span>
              The teaching
              <span className="bar"></span>
            </div>
            {scriptParagraphs.length > 0 ? (
              scriptParagraphs.map((para, i) => (
                <p key={i}>{para}</p>
              ))
            ) : (
              <p>
                <em>Script coming soon.</em>
              </p>
            )}
          </article>
        </>
      ) : (
        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "48px 48px 0" }}>
          <h1 style={{ fontFamily: "var(--ff-display)", color: "var(--ink-900)" }}>
            Teaching not found
          </h1>
          <p>
            <Link href="/videos">Browse all teachings →</Link>
          </p>
        </div>
      )}

      {nearbyList.length > 0 && (
        <section className="more-section">
          <div className="more-head">
            <h2>
              More <em>teachings</em>
            </h2>
            <Link href="/videos" className="more">
              All 52 parshiot &rarr;
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
                  durationLabel: "0:45",
                }}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
