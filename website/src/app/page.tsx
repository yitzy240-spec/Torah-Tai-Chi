import Link from "next/link";
import { getAllParshiot } from "@/lib/parshiot";
import { getAllArticles } from "@/lib/articles";
import { getSiteContent, splitEm } from "@/lib/site-content";
import { getThisWeekParsha } from "@/lib/hebcal";
import VideoCard from "@/components/VideoCard";
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

const FALLBACK_PARSHIOT = [
  { name: "Kedoshim", slug: "kedoshim", heb: "קדושים", book: "Leviticus", dur: "0:48" },
  { name: "Acharei Mot", slug: "acharei-mot", heb: "אחרי מות", book: "Leviticus", dur: "0:45" },
  { name: "Shemot", slug: "shemot", heb: "שמות", book: "Exodus", dur: "0:52" },
  { name: "Bo", slug: "bo", heb: "בא", book: "Exodus", dur: "0:47" },
];

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

  const recentFour = withScript.slice(0, 4);
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
          <div className="hero-cta">
            {thisWeek && (
              <Link href={`/videos/${thisWeek.slug}`} className="btn btn-primary">
                Watch this week&apos;s teaching
              </Link>
            )}
            {!thisWeek && (
              <Link href="/videos" className="btn btn-primary">
                Watch this week&apos;s teaching
              </Link>
            )}
            <Link href="/videos" className="btn btn-ghost">
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
            <div className="play">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            {thisWeek && (
              <div className="vlabel">
                {thisWeek.name} &mdash; {thisWeek.atightTitle ?? "~45s"}
              </div>
            )}
          </div>
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
        <div className="video-grid">
          {recentFour.length > 0
            ? recentFour.map((p) => (
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
                  thumbUrl={p.thumbUrl}
                  isCurrentWeek={p.slug === thisWeek?.slug}
                />
              ))
            : FALLBACK_PARSHIOT.map((p) => (
                <Link key={p.slug} href={`/videos/${p.slug}`} className="v-card">
                  <div className="thumb">
                    <span className="dur">{p.dur}</span>
                  </div>
                  <div className="v-heb" lang="he" dir="rtl">{p.heb}</div>
                  <div className="v-name">{p.name}</div>
                  <div className="v-book">{p.book}</div>
                </Link>
              ))}
        </div>
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

      {/* ABOUT STRIP — editorial dojo portrait of Rav Eli (landscape crop)
          next to the practice-between-traditions copy. Styling lives in
          .about-strip / .about-portrait in globals.css. */}
      <section className="about-strip stagger">
        <div className="about-portrait">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/rav-eli-landscape.jpg"
            alt="Rav Eli in his dojo — afternoon light on cedar walls, Hebrew scroll in the background"
            width={1600}
            height={1073}
            loading="lazy"
          />
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
