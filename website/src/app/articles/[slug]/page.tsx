import type { Metadata } from "next";
import Link from "next/link";
import { getAllArticles, getArticleBySlug, tiptapJsonToHtml } from "@/lib/articles";
import ArticleCard from "@/components/ArticleCard";

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
  const description = article.excerpt ?? article.subtitle ?? undefined;
  const ogImageUrl = `/og/article/${slug}`;
  return {
    title: article.title,
    description,
    openGraph: {
      title: `${article.title} · Torah Tai Chi`,
      description,
      type: "article",
      url: `https://torahtaichi.com/articles/${slug}`,
      siteName: "Torah Tai Chi",
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${article.title} · Torah Tai Chi`,
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

  return (
    <>
      <div className="back-wrap" style={{ maxWidth: "720px" }}>
        <Link href="/articles" className="back-link">
          &larr; All writings
        </Link>
      </div>

      <header className="ad-header stagger">
        {article.category && <span className="ad-tag">{article.category}</span>}
        <h1>{article.title}</h1>
        {article.subtitle && <p className="ad-deck">{article.subtitle}</p>}
        <div className="ad-meta">
          {formatDate(article.published_at)}
          {article.published_at && article.read_minutes ? " · " : ""}
          {article.read_minutes ? `${article.read_minutes} min read` : ""}
        </div>
      </header>

      <article className="ad-body stagger">
        {bodyHtml ? (
          <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <p style={{ color: "var(--ink-400)", fontStyle: "italic" }}>No content yet.</p>
        )}
      </article>

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
