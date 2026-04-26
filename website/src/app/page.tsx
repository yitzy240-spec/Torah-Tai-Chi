import Link from "next/link";
import { getAllParshiot } from "@/lib/parshiot";
import { getAllArticles } from "@/lib/articles";
import { getSiteContent, splitEm } from "@/lib/site-content";
import { getThisWeekParsha } from "@/lib/hebcal";
import RecentTeachingsCarousel, { type CarouselCard } from "@/components/RecentTeachingsCarousel";
import ArticleCard from "@/components/ArticleCard";
import Brand from "@/components/Brand";

// ISR: revalidate every 60 s; Storyblok webhook triggers on-demand revalidation
export const revalidate = 60;

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

export default async function HomePage() {
  let parshiot: Awaited<ReturnType<typeof getAllParshiot>> = [];
  try {
    parshiot = await getAllParshiot();
  } catch {
    parshiot = [];
  }
  const withScript = parshiot.filter((p) => p.atightScript);

  // Feature A: Hebcal live parsha — fall back to first-with-script if Hebcal fails
  const hebcalParsha = await getThisWeekParsha();
  const hebcalMatch = hebcalParsha
    ? (parshiot.find((p) => p.slug === hebcalParsha.slug) ?? null)
    : null;
  const thisWeek = hebcalMatch ?? withScript[0] ?? parshiot[0];

  // Carousel data: only parshiot that have a rendered video. Empty
  // placeholder cards looked like "everything's coming soon" — better
  // to show fewer real cards swipeable as a row than to fill the grid
  // with placeholder thumbs. Full library is still /videos.
  const carouselCards: CarouselCard[] = withScript
    .filter((p) => !!p.thumbUrl)
    .slice(0, 8)
    .map((p) => {
      // Trim the script to ~28 words / ~180 chars for the flip preview.
      // Stop at the end of the first sentence past 90 chars so we don't
      // chop mid-sentence on short scripts.
      const text = (p.atightScript ?? '').trim();
      let preview = text;
      if (preview.length > 200) {
        const minCut = preview.slice(0, 90);
        const restMatch = preview.slice(90).match(/^[^.!?]*[.!?]/);
        preview = (minCut + (restMatch?.[0] ?? '')).trim();
        if (preview.length > 200) preview = preview.slice(0, 200).replace(/\s+\S*$/, '') + '…';
      }
      return {
        name: p.name,
        slug: p.slug,
        hebrewName: p.hebrewName,
        bookShortName: BOOK_SHORT[p.book] ?? p.book,
        thumbUrl: p.thumbUrl ?? null,
        isCurrentWeek: p.slug === thisWeek?.slug,
        preview: preview || `${p.name} — a ~45-second teaching.`,
      };
    });
  const allArticles = await getAllArticles();
  const recentArticles = allArticles.slice(0, 3);
  const content = await getSiteContent();
  const heroTitle = splitEm(content['home.hero.title'], content['home.hero.title_em']);

  return (
    <>
      {/* HERO */}
      <section className="hero stagger">
        <div className="hero-text">
          <div className="hero-kicker">
            <span className="bar"></span>
            {content['home.hero.kicker']}
          </div>
          <h1>
            {heroTitle.before}
            {heroTitle.em && <em>{heroTitle.em}</em>}
            {heroTitle.after}
          </h1>
          <p className="hero-body">{content['home.hero.body']}</p>
          <div className="hero-cta hero-cta-desktop">
            {thisWeek && (
              <Link href={`/videos/${thisWeek.slug}`} className="btn btn-primary">
                Play {thisWeek.name} teaching
                <span aria-hidden="true" className="btn-arrow">→</span>
              </Link>
            )}
            {!thisWeek && (
              <Link href="/videos" className="btn btn-primary">
                Play this week&apos;s teaching
                <span aria-hidden="true" className="btn-arrow">→</span>
              </Link>
            )}
            <Link href="/videos" className="hero-cta-link">
              Explore all parshiot
            </Link>
          </div>
        </div>

        <div className="hero-video">
          {thisWeek && (
            <div className="video-parsha-tag">
              This week: {thisWeek.name}{" "}
              <span className="heb" lang="he" dir="rtl">
                {thisWeek.hebrewName}
              </span>
            </div>
          )}
          <div className="video-frame">
            {thisWeek?.videoUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                src={thisWeek.videoUrl}
                poster={thisWeek.thumbUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
              />
            ) : (
              <div className="play">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            )}
          </div>
          {thisWeek && (
            <div className="video-caption">
              <span className="video-caption-name">{thisWeek.name}</span>
              <span className="video-caption-sep" aria-hidden="true">·</span>
              <span className="video-caption-title">
                {thisWeek.atightTitle ?? "~45s teaching"}
              </span>
            </div>
          )}
        </div>

        {/* Mobile-only CTA — on mobile this appears AFTER the video.
            On desktop it's hidden and the in-text CTA above is used. */}
        <div className="hero-cta hero-cta-mobile">
          {thisWeek && (
            <Link href={`/videos/${thisWeek.slug}`} className="btn btn-primary">
              Play {thisWeek.name} teaching
              <span aria-hidden="true" className="btn-arrow">→</span>
            </Link>
          )}
          {!thisWeek && (
            <Link href="/videos" className="btn btn-primary">
              Play this week&apos;s teaching
              <span aria-hidden="true" className="btn-arrow">→</span>
            </Link>
          )}
          <Link href="/videos" className="hero-cta-link">
            Explore all parshiot
          </Link>
        </div>
      </section>

      {/* DIVIDER */}
      <div className="divider">
        <div className="divider-line"></div>
        <div className="divider-text">
          <span>
            <span className="ch">松</span> rooted release, not collapse{" "}
            <span className="ch">·</span> the craft compounds{" "}
            <span className="ch">勁</span>
          </span>
        </div>
      </div>

      {/* RECENT VIDEOS */}
      <section className="recent stagger">
        <div className="section-head">
          <h2>Recent teachings</h2>
          <Link href="/videos" className="more">
            All 54 parshiot →
          </Link>
        </div>
        {carouselCards.length > 0 ? (
          <RecentTeachingsCarousel cards={carouselCards} />
        ) : (
          <p
            style={{
              fontFamily: "var(--ff-display)",
              fontStyle: "italic",
              fontSize: "15px",
              color: "var(--ink-400)",
              textAlign: "center",
              padding: "32px 16px",
            }}
          >
            The first teaching drops this week.{" "}
            <Link href="/videos" style={{ color: "var(--cedar-600)" }}>
              Browse all 54 parshiot →
            </Link>
          </p>
        )}
      </section>

      {/* RECENT ARTICLES */}
      <section className="recent stagger" style={{ paddingTop: "88px" }}>
        <div className="section-head">
          <h2>From the writings</h2>
          <Link href="/articles" className="more">
            All articles →
          </Link>
        </div>
        <div className="article-grid">
          {recentArticles.map((a) => (
            <ArticleCard key={a.slug} article={a} />
          ))}
        </div>
      </section>

      {/* ABOUT STRIP */}
      <section className="about-strip stagger">
        <div className="about-portrait">
          <Brand size={140} />
        </div>
        <div className="about-body">
          <h2>{content['home.about.title']}</h2>
          {content['home.about.body'].split(/\n\n+/).filter(Boolean).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </section>
    </>
  );
}
