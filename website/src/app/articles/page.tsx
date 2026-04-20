import type { Metadata } from "next";
import Link from "next/link";
import { getAllArticles } from "@/lib/articles";

export const metadata: Metadata = {
  title: "Writings",
  description:
    "Reflections on where wisdom lives in the body. Long-form essays, teachings, and reflections.",
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

function formatDate(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export default async function ArticlesPage() {
  const articles = await getAllArticles();

  return (
    <>
      <header className="page-header stagger">
        <div className="page-kicker">THE WRITINGS</div>
        <h1>From the writings</h1>
        <p className="page-subtitle">
          <em>Reflections on where wisdom lives in the body.</em>
        </p>
      </header>

      <section className="articles-section stagger">
        {articles.length === 0 && (
          <p style={{ fontStyle: "italic", color: "var(--ink-400)", fontFamily: "var(--ff-display)" }}>
            No articles published yet.
          </p>
        )}
        {articles.map((article) => (
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
