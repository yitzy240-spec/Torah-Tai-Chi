import type { Metadata } from "next";
import Link from "next/link";
import { getAllArticles, getArticleBySlug, tiptapJsonToHtml } from "@/lib/articles";
import ArticleCard from "@/components/ArticleCard";
import ShareButton from "@/components/ShareButton";
import { articleSchema, breadcrumbSchema } from "@/lib/jsonld";

interface Props {
  params: Promise<{ slug: string }>;
}

// ISR: revalidate every 60 s; new article slugs served on demand
export const revalidate = 60;
export const dynamicParams = true;

// Fallback slugs used when Supabase returns no articles (e.g. empty DB at first build).
// After running supabase/seed_articles.sql these will all exist in Supabase.
const FIXTURE_SLUGS = [
  'why-the-body-knows',
  'song-and-anavah',
  'shabbat-stillness-in-motion',
  'soft-jaw-moment',
  'rooting-patriarchs',
  'breath-as-first-blessing',
  'yielding-is-not-surrender',
  'naase-vnishma',
];

export async function generateStaticParams() {
  try {
    const articles = await getAllArticles();
    if (articles.length > 0) {
      return articles.map((a) => ({ slug: a.slug }));
    }
  } catch {
    // fall through to fixtures
  }
  // Pre-seed fallback so static export always has params to generate
  return FIXTURE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) return { title: "Article" };
  const description = article.seo_description ?? article.excerpt ?? article.subtitle ?? undefined;
  const titleStr = article.seo_title ?? article.title;
  const ogImageUrl = article.seo_og_image ?? `/og/article/${slug}`;
  return {
    title: titleStr,
    description,
    alternates: {
      canonical: `https://torahtaichi.com/articles/${slug}`,
      types: { "application/rss+xml": "/articles/feed.xml" },
    },
    openGraph: {
      title: `${titleStr} · Torah Tai Chi`,
      description,
      type: "article",
      url: `https://torahtaichi.com/articles/${slug}`,
      siteName: "Torah Tai Chi",
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${titleStr} · Torah Tai Chi`,
      description,
    },
  };
}

function formatDate(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function ArticleDetailPage({ params }: Props) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);

  if (!article) {
    return (
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 48px 0" }}>
        <h1 style={{ fontFamily: "var(--ff-display)" }}>Article not found</h1>
        <Link href="/articles">← All writings</Link>
      </div>
    );
  }

  // Use pre-rendered HTML; fall back to JSON-to-HTML conversion
  const bodyHtml = article.body_html || tiptapJsonToHtml(article.body_json);

  const allArticles = await getAllArticles();
  const otherArticles = allArticles.filter((a) => a.slug !== slug).slice(0, 2);

  const artSchema = JSON.stringify(
    articleSchema({
      title: article.title,
      description: article.excerpt ?? article.subtitle ?? undefined,
      datePublished: article.published_at ?? undefined,
      slug: article.slug,
    })
  );
  const crumbSchema = JSON.stringify(
    breadcrumbSchema([
      { name: "Home", url: "https://torahtaichi.com" },
      { name: "Writings", url: "https://torahtaichi.com/articles" },
      { name: article.title, url: `https://torahtaichi.com/articles/${slug}` },
    ])
  );

  const pageUrl = `https://torahtaichi.com/articles/${slug}`;
  const formattedDate = formatDate(article.published_at);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: artSchema }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: crumbSchema }} />

      <header className="ad-header stagger">
        {/* Subtle meta row sits above the H1 so H1 owns the hierarchy */}
        <div className="ad-eyebrow">
          <Link href="/articles" className="ad-eyebrow-back" prefetch={false}>
            &larr; All writings
          </Link>
          {article.category && (
            <>
              <span className="ad-eyebrow-sep" aria-hidden="true">·</span>
              <span className="ad-eyebrow-tag">{article.category}</span>
            </>
          )}
        </div>

        <h1>{article.title}</h1>
        {article.subtitle && <p className="ad-deck">{article.subtitle}</p>}

        {/* Essays run under the organizational voice — no individual byline. */}
        <div className="ad-byline">
          {formattedDate && (
            <time dateTime={article.published_at ?? undefined}>{formattedDate}</time>
          )}
          {formattedDate && article.read_minutes ? (
            <span className="ad-byline-sep" aria-hidden="true">·</span>
          ) : null}
          {article.read_minutes ? (
            <span>{article.read_minutes} min read</span>
          ) : null}
        </div>
      </header>

      <article className="ad-body stagger">
        {bodyHtml ? (
          <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <p style={{ color: "var(--ink-400)", fontStyle: "italic" }}>No content yet.</p>
        )}
      </article>

      {/* End-of-article rail: share + back + related */}
      <section className="ad-endrail">
        <div className="ad-endrail-actions">
          <Link href="/articles" className="hero-cta-link">
            &larr; Back to essays
          </Link>
          <ShareButton url={pageUrl} title={article.title} />
        </div>
      </section>

      {otherArticles.length > 0 && (
        <section className="continue-section">
          <h2 className="continue-head">
            Continue <em>reading</em>
          </h2>
          <div className="continue-grid stagger">
            {otherArticles.map((a) => (
              <ArticleCard key={a.slug} article={a} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
