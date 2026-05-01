import type { Metadata } from "next";
import Link from "next/link";
import { getAllArticles } from "@/lib/articles";
import { getSiteContent } from "@/lib/site-content";

// ISR: revalidate every 60 s
export const revalidate = 60;

interface ArticlesPageProps {
  searchParams: Promise<{ category?: string | string[] }>;
}

export const metadata: Metadata = {
  title: "Writings",
  description:
    "Reflections on where wisdom lives in the body. Long-form essays, teachings, and reflections.",
  alternates: {
    canonical: "https://torahtaichi.com/articles",
    types: { "application/rss+xml": "/articles/feed.xml" },
  },
  openGraph: {
    title: "Writings · Torah Tai Chi",
    description:
      "Reflections on where wisdom lives in the body. Long-form essays, teachings, and reflections.",
    type: "website",
    url: "https://torahtaichi.com/articles",
    siteName: "Torah Tai Chi",
    images: [{ url: "/og/default.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Writings · Torah Tai Chi",
    description:
      "Reflections on where wisdom lives in the body. Long-form essays, teachings, and reflections.",
  },
};

// Include the year so freshness is never ambiguous (resolves web-articles-1)
function formatDate(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

type CategoryKey = "all" | "essay" | "teaching" | "reflection";

function normaliseCategory(raw: string | string[] | undefined): CategoryKey {
  if (!raw) return "all";
  const value = (Array.isArray(raw) ? raw[0] : raw).toLowerCase();
  if (value === "essay" || value === "teaching" || value === "reflection") return value;
  return "all";
}

export default async function ArticlesPage({ searchParams }: ArticlesPageProps) {
  const articles = await getAllArticles();
  const { category: rawCategory } = await searchParams;
  const activeCategory = normaliseCategory(rawCategory);
  const content = await getSiteContent();

  const CATEGORIES: { key: CategoryKey; label: string }[] = [
    { key: "all", label: content['articles.category.all'] },
    { key: "essay", label: content['articles.category.essay'] },
    { key: "teaching", label: content['articles.category.teaching'] },
    { key: "reflection", label: content['articles.category.reflection'] },
  ];

  const visibleArticles =
    activeCategory === "all"
      ? articles
      : articles.filter((a) => (a.category ?? "").toLowerCase() === activeCategory);

  return (
    <>
      <header className="page-header stagger">
        <div className="page-kicker">{content['articles.kicker']}</div>
        <h1>{content['articles.title']}</h1>
        <p className="page-subtitle">
          <em>{content['articles.subtitle']}</em>
        </p>
      </header>

      <nav className="filter-bar" aria-label="Filter by category">
        {CATEGORIES.map((c) => {
          const href = c.key === "all" ? "/articles" : `/articles?category=${c.key}`;
          const isActive = activeCategory === c.key;
          return (
            <Link
              key={c.key}
              href={href}
              className={`filter-pill${isActive ? " active" : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              {c.label}
            </Link>
          );
        })}
      </nav>

      <section className="articles-section stagger">
        {visibleArticles.length === 0 && (
          <p style={{ fontStyle: "italic", color: "var(--ink-400)", fontFamily: "var(--ff-display)" }}>
            {articles.length === 0
              ? content['articles.empty.no_articles']
              : `No articles in "${activeCategory}" yet.`}
          </p>
        )}
        {visibleArticles.map((article) => (
          <Link key={article.slug} href={`/articles/${article.slug}`} className="article-entry">
            <span className="ae-tag">{article.category}</span>
            <h2 className="ae-title">{article.title}</h2>
            {article.excerpt && <p className="ae-excerpt">{article.excerpt}</p>}
            <div className="ae-meta">
              {formatDate(article.published_at)}
              {article.published_at && article.read_minutes ? " · " : ""}
              {article.read_minutes ? `${article.read_minutes} min read` : ""}
            </div>
          </Link>
        ))}
      </section>
    </>
  );
}
