import type { Metadata } from "next";
import Link from "next/link";
import { ARTICLES } from "@/data/articles";

export const metadata: Metadata = {
  title: "Articles",
  description: "Reflections on where wisdom lives in the body. Long-form essays, teachings, and reflections.",
};

export default function ArticlesPage() {
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
        {ARTICLES.map((article) => (
          <Link key={article.slug} href={`/articles/${article.slug}`} className="article-entry">
            <span className="ae-tag">{article.category}</span>
            <h2 className="ae-title">{article.title}</h2>
            <p className="ae-excerpt">{article.excerpt}</p>
            <div className="ae-meta">
              {article.date} &middot; {article.readMinutes} min read
            </div>
          </Link>
        ))}
      </section>
    </>
  );
}
