import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import ShareButton from "@/components/ShareButton";
import type { Article } from "@/lib/articles";

export function ArticleView({
  article,
  bodyHtml,
  otherArticles,
  pageUrl,
}: {
  article: Article;
  bodyHtml: string;
  otherArticles: Article[];
  pageUrl: string;
}) {
  const formattedDate = article.published_at
    ? new Date(article.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";
  return (
    <>
      <header className="ad-header stagger">
        {/* Subtle meta row sits above the H1 so H1 owns the hierarchy */}
        <div className="ad-eyebrow">
          <Link href="/articles" className="ad-eyebrow-back">
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
